import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { reaction, milestone, segment, comment, userProfile, user } from '$lib/server/db/schema';
import { eq, desc, sql, like, or, inArray } from 'drizzle-orm';

const PAGE_SIZE = 25;

export const load: PageServerLoad = async ({ url }) => {
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
	const search = url.searchParams.get('search') || '';
	const emojiFilter = url.searchParams.get('emoji') || '';
	const targetFilter = url.searchParams.get('target') || ''; // 'milestone' or 'comment'

	// Build where conditions
	const conditions = [];
	
	if (emojiFilter) {
		conditions.push(eq(reaction.emoji, emojiFilter));
	}
	
	if (targetFilter === 'milestone') {
		conditions.push(sql`${reaction.milestoneId} IS NOT NULL`);
	} else if (targetFilter === 'comment') {
		conditions.push(sql`${reaction.commentId} IS NOT NULL`);
	}

	// Get total count for pagination
	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(reaction)
		.innerJoin(user, eq(reaction.userId, user.id))
		.leftJoin(userProfile, eq(reaction.userId, userProfile.userId))
		.where(conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined);
	
	let totalCount = Number(countResult[0]?.count ?? 0);

	// Fetch paginated reactions with related user, profile, and target info
	let query = db
		.select({
			id: reaction.id,
			emoji: reaction.emoji,
			createdAt: reaction.createdAt,
			userId: reaction.userId,
			milestoneId: reaction.milestoneId,
			commentId: reaction.commentId,
			// User info
			userEmail: user.email,
			profileFirstName: userProfile.firstName,
			profileLastName: userProfile.lastName,
			// Milestone info (may be null if reaction is on comment)
			milestoneTitle: milestone.title,
			segmentName: segment.name,
			segmentIcon: segment.icon
		})
		.from(reaction)
		.innerJoin(user, eq(reaction.userId, user.id))
		.leftJoin(userProfile, eq(reaction.userId, userProfile.userId))
		.leftJoin(milestone, eq(reaction.milestoneId, milestone.id))
		.leftJoin(segment, eq(milestone.segmentId, segment.id))
		.where(conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined)
		.orderBy(desc(reaction.createdAt))
		.limit(PAGE_SIZE)
		.offset((page - 1) * PAGE_SIZE);

	const reactionsWithDetails = await query;

	// For reactions on comments, fetch the comment and its milestone info
	const commentIds = reactionsWithDetails
		.filter(r => r.commentId && !r.milestoneId)
		.map(r => r.commentId as string);

	let commentMilestoneMap: Record<string, { milestoneId: string; milestoneTitle: string; segmentName: string; segmentIcon: string }> = {};
	
	if (commentIds.length > 0) {
		const commentsWithMilestones = await db
			.select({
				commentId: comment.id,
				milestoneId: comment.milestoneId,
				milestoneTitle: milestone.title,
				segmentName: segment.name,
				segmentIcon: segment.icon
			})
			.from(comment)
			.innerJoin(milestone, eq(comment.milestoneId, milestone.id))
			.innerJoin(segment, eq(milestone.segmentId, segment.id))
			.where(inArray(comment.id, commentIds));

		for (const c of commentsWithMilestones) {
			commentMilestoneMap[c.commentId] = {
				milestoneId: c.milestoneId,
				milestoneTitle: c.milestoneTitle,
				segmentName: c.segmentName,
				segmentIcon: c.segmentIcon
			};
		}
	}

	// Get emoji counts for filter badges (from full dataset)
	const emojiCounts = await db
		.select({
			emoji: reaction.emoji,
			count: sql<number>`count(*)`
		})
		.from(reaction)
		.groupBy(reaction.emoji)
		.orderBy(desc(sql`count(*)`));

	// Get target type counts
	const milestoneCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(reaction)
		.where(sql`${reaction.milestoneId} IS NOT NULL`);
	
	const commentCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(reaction)
		.where(sql`${reaction.commentId} IS NOT NULL`);

	const totalPages = Math.ceil(totalCount / PAGE_SIZE);

	return {
		reactions: reactionsWithDetails.map(r => {
			const commentInfo = r.commentId ? commentMilestoneMap[r.commentId] : null;
			return {
				id: r.id,
				emoji: r.emoji,
				createdAt: r.createdAt.toISOString(),
				userId: r.userId,
				targetType: r.milestoneId ? 'milestone' : 'comment',
				targetId: r.milestoneId ?? r.commentId,
				// User display name
				userName: r.profileFirstName
					? (r.profileLastName ? `${r.profileFirstName} ${r.profileLastName}` : r.profileFirstName)
					: r.userEmail,
				userEmail: r.userEmail,
				// Entry info
				milestoneId: r.milestoneId ?? commentInfo?.milestoneId ?? null,
				milestoneTitle: r.milestoneTitle ?? commentInfo?.milestoneTitle ?? null,
				segmentName: r.segmentName ?? commentInfo?.segmentName ?? null,
				segmentIcon: r.segmentIcon ?? commentInfo?.segmentIcon ?? null
			};
		}),
		pagination: {
			page,
			pageSize: PAGE_SIZE,
			totalCount,
			totalPages
		},
		filters: {
			search,
			emoji: emojiFilter,
			target: targetFilter
		},
		emojiCounts: emojiCounts.map(e => ({ emoji: e.emoji, count: Number(e.count) })),
		targetCounts: {
			all: Number(milestoneCount[0]?.count ?? 0) + Number(commentCount[0]?.count ?? 0),
			milestone: Number(milestoneCount[0]?.count ?? 0),
			comment: Number(commentCount[0]?.count ?? 0)
		}
	};
};
