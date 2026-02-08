import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { milestone, segment, milestoneMedia, reaction, videoJob, comment } from '$lib/server/db/schema';
import { desc, eq, sql, count, and } from 'drizzle-orm';

type MetaItem = {
	type: 'coordinates' | 'link' | 'icon';
	value: string;
	label?: string;
	icon?: string;
};

type ReactionCount = {
	emoji: string;
	count: number;
	userReacted: boolean;
};

type MediaItem = {
	type: 'image' | 'video';
	url: string;
	thumbnailUrl?: string;
	isReady: boolean; // for videos: true when transcoding is complete
};

type MilestoneResponse = {
	id: string;
	title: string;
	description: string | null;
	date: { month: string; day: string; year: string };
	media?: MediaItem[];
	avatar: string | null;
	side: 'left' | 'right';
	segment: string;
	segmentIcon: string;
	meta?: MetaItem[];
	commentCount?: number;
	reactions?: ReactionCount[];
};

const PAGE_SIZE = 10;

export const GET: RequestHandler = async ({ url, locals }) => {
	const offset = parseInt(url.searchParams.get('offset') || '0');
	const limit = parseInt(url.searchParams.get('limit') || String(PAGE_SIZE));
	const userId = locals.user?.id;

	// Fetch milestones with their segments
	const milestonesWithSegments = await db
		.select({
			id: milestone.id,
			title: milestone.title,
			description: milestone.description,
			date: milestone.date,
			avatar: milestone.avatar,
			meta: milestone.meta,
			segmentName: segment.name,
			segmentIcon: segment.icon,
			segmentSortOrder: segment.sortOrder,
		})
		.from(milestone)
		.innerJoin(segment, eq(milestone.segmentId, segment.id))
		.where(eq(milestone.published, true))
		.orderBy(desc(segment.sortOrder), desc(milestone.date))
		.limit(limit + 1) // Fetch one extra to check if there are more
		.offset(offset);

	const hasMore = milestonesWithSegments.length > limit;
	const milestoneList = hasMore ? milestonesWithSegments.slice(0, limit) : milestonesWithSegments;

	// Get all milestone IDs for batch fetching
	const milestoneIds = milestoneList.map(m => m.id);

	if (milestoneIds.length === 0) {
		return json({
			milestones: [],
			hasMore: false,
			total: 0
		});
	}

	// Fetch media for all milestones (with video job status for isReady check)
	const allMedia = await db
		.select({
			milestoneId: milestoneMedia.milestoneId,
			url: milestoneMedia.url,
			type: milestoneMedia.type,
			thumbnailUrl: milestoneMedia.thumbnailUrl,
			videoJobId: milestoneMedia.videoJobId,
			videoJobStatus: videoJob.status,
		})
		.from(milestoneMedia)
		.leftJoin(videoJob, eq(milestoneMedia.videoJobId, videoJob.id))
		.where(sql`${milestoneMedia.milestoneId} IN ${milestoneIds}`)
		.orderBy(milestoneMedia.sortOrder);

	// Group media by milestone
	const mediaByMilestone = allMedia.reduce((acc, m) => {
		if (!acc[m.milestoneId]) acc[m.milestoneId] = [];
		acc[m.milestoneId].push(m);
		return acc;
	}, {} as Record<string, typeof allMedia>);

	// Fetch reactions for all milestones
	const allReactions = await db
		.select({
			milestoneId: reaction.milestoneId,
			emoji: reaction.emoji,
			userId: reaction.userId,
		})
		.from(reaction)
		.where(sql`${reaction.milestoneId} IN ${milestoneIds}`);

	// Group reactions by milestone
	const reactionsByMilestone = allReactions.reduce((acc, r) => {
		if (!r.milestoneId) return acc;
		if (!acc[r.milestoneId]) acc[r.milestoneId] = [];
		acc[r.milestoneId].push(r);
		return acc;
	}, {} as Record<string, typeof allReactions>);

	// Fetch comment counts for all milestones
	const commentCounts = await db
		.select({
			milestoneId: comment.milestoneId,
			count: count()
		})
		.from(comment)
		.where(sql`${comment.milestoneId} IN ${milestoneIds}`)
		.groupBy(comment.milestoneId);

	const commentCountByMilestone = commentCounts.reduce((acc, c) => {
		acc[c.milestoneId] = c.count;
		return acc;
	}, {} as Record<string, number>);

	// Build response
	const milestones: MilestoneResponse[] = milestoneList.map((m, index) => {
		const date = new Date(m.date);
		const rawMedia = mediaByMilestone[m.id] || [];
		
		// Transform media with video status
		const mediaItems: MediaItem[] = rawMedia.map(med => {
			if (med.type === 'video') {
				// Video is ready if:
				// 1. No job exists (no processing needed or legacy video), OR
				// 2. Job exists and is completed
				const hasJob = !!med.videoJobId;
				const jobCompleted = med.videoJobStatus === 'completed';
				const isReady = !hasJob || jobCompleted;
				
				return {
					type: 'video' as const,
					url: med.url,
					thumbnailUrl: med.thumbnailUrl || undefined,
					isReady
				};
			}
			return {
				type: 'image' as const,
				url: med.url,
				thumbnailUrl: med.thumbnailUrl || undefined,
				isReady: true
			};
		});
		
		// Group reactions by emoji
		const milestoneReactions = reactionsByMilestone[m.id] || [];
		const groupedReactions = milestoneReactions.reduce((acc, r) => {
			if (!acc[r.emoji]) {
				acc[r.emoji] = { count: 0, userReacted: false };
			}
			acc[r.emoji].count++;
			if (userId && r.userId === userId) {
				acc[r.emoji].userReacted = true;
			}
			return acc;
		}, {} as Record<string, { count: number; userReacted: boolean }>);

		const reactions: ReactionCount[] = Object.entries(groupedReactions).map(([emoji, data]) => ({
			emoji,
			count: data.count,
			userReacted: data.userReacted
		}));

		const commentCount = commentCountByMilestone[m.id] || 0;

		return {
			id: m.id,
			title: m.title,
			description: m.description,
			date: {
				month: date.toLocaleString('en-US', { month: 'short' }),
				day: date.getDate().toString().padStart(2, '0'),
				year: date.getFullYear().toString()
			},
			media: mediaItems.length > 0 ? mediaItems : undefined,
			avatar: m.avatar,
			side: ((offset + index) % 2 === 0 ? 'left' : 'right') as 'left' | 'right',
			segment: m.segmentName,
			segmentIcon: m.segmentIcon,
			meta: m.meta && m.meta.length > 0 ? m.meta : undefined,
			commentCount: commentCount > 0 ? commentCount : undefined,
			reactions: reactions.length > 0 ? reactions : undefined
		};
	});

	// Get total count
	const totalResult = await db.select({ count: count() }).from(milestone);
	const total = totalResult[0]?.count || 0;

	return json({
		milestones,
		hasMore,
		total
	});
};
