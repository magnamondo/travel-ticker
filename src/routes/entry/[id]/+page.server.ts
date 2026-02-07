import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { milestone, segment, milestoneMedia, comment, reaction, userProfile } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { canComment, canReact } from '$lib/roles';

export const load: PageServerLoad = async ({ params, locals }) => {
	// Fetch milestone with segment
	const milestoneResult = await db
		.select({
			id: milestone.id,
			title: milestone.title,
			description: milestone.description,
			date: milestone.date,
			avatar: milestone.avatar,
			meta: milestone.meta,
			segmentName: segment.name,
			segmentIcon: segment.icon
		})
		.from(milestone)
		.innerJoin(segment, eq(milestone.segmentId, segment.id))
		.where(eq(milestone.id, params.id))
		.get();

	if (!milestoneResult) {
		throw error(404, 'Entry not found');
	}

	// Fetch media for milestone
	const media = await db
		.select()
		.from(milestoneMedia)
		.where(eq(milestoneMedia.milestoneId, params.id))
		.orderBy(milestoneMedia.sortOrder);

	// Fetch comments for milestone
	const comments = await db
		.select()
		.from(comment)
		.where(eq(comment.milestoneId, params.id));

	// Fetch reactions for milestone
	const milestoneReactions = await db
		.select()
		.from(reaction)
		.where(eq(reaction.milestoneId, params.id));

	// Group milestone reactions by emoji
	const reactionCounts: Record<string, { count: number; userReacted: boolean }> = {};
	for (const r of milestoneReactions) {
		if (!reactionCounts[r.emoji]) {
			reactionCounts[r.emoji] = { count: 0, userReacted: false };
		}
		reactionCounts[r.emoji].count++;
		if (locals.user && r.userId === locals.user.id) {
			reactionCounts[r.emoji].userReacted = true;
		}
	}

	// Fetch reactions for all comments
	const commentIds = comments.map(c => c.id);
	const allCommentReactions = [];
	for (const commentId of commentIds) {
		const reactions = await db
			.select()
			.from(reaction)
			.where(eq(reaction.commentId, commentId));
		allCommentReactions.push(...reactions);
	}

	// Group comment reactions by commentId then by emoji
	const commentReactionsByComment: Record<string, Record<string, { count: number; userReacted: boolean }>> = {};
	for (const r of allCommentReactions) {
		if (!r.commentId) continue;
		if (!commentReactionsByComment[r.commentId]) {
			commentReactionsByComment[r.commentId] = {};
		}
		if (!commentReactionsByComment[r.commentId][r.emoji]) {
			commentReactionsByComment[r.commentId][r.emoji] = { count: 0, userReacted: false };
		}
		commentReactionsByComment[r.commentId][r.emoji].count++;
		if (locals.user && r.userId === locals.user.id) {
			commentReactionsByComment[r.commentId][r.emoji].userReacted = true;
		}
	}

	// Calculate total reaction count per comment
	const getReactionCount = (commentId: string): number => {
		const reactions = commentReactionsByComment[commentId];
		if (!reactions) return 0;
		return Object.values(reactions).reduce((sum, r) => sum + r.count, 0);
	};

	// Sort comments by reaction count (desc), then by createdAt (desc)
	comments.sort((a, b) => {
		const countDiff = getReactionCount(b.id) - getReactionCount(a.id);
		if (countDiff !== 0) return countDiff;
		return b.createdAt.getTime() - a.createdAt.getTime();
	});

	// Get user display name if logged in
	let userDisplayName: string | null = null;
	if (locals.user) {
		const profile = await db
			.select()
			.from(userProfile)
			.where(eq(userProfile.userId, locals.user.id))
			.get();
		
		if (profile?.firstName) {
			userDisplayName = profile.lastName 
				? `${profile.firstName} ${profile.lastName}`
				: profile.firstName;
		} else {
			userDisplayName = locals.user.email;
		}
	}

	return {
		milestone: {
			id: milestoneResult.id,
			title: milestoneResult.title,
			description: milestoneResult.description,
			segment: milestoneResult.segmentName,
			segmentIcon: milestoneResult.segmentIcon,
			avatar: milestoneResult.avatar,
			images: media.filter(m => m.type === 'image').map(m => m.url),
			videos: media.filter(m => m.type === 'video').map(m => ({
				url: m.url,
				thumbnailUrl: m.thumbnailUrl,
				duration: m.duration
			})),
			date: {
				month: milestoneResult.date.toLocaleString('en-US', { month: 'short' }),
				day: milestoneResult.date.getDate().toString(),
				year: milestoneResult.date.getFullYear().toString()
			},
			reactions: reactionCounts,
			meta: milestoneResult.meta && milestoneResult.meta.length > 0 ? milestoneResult.meta : null
		},
		comments: comments.map(c => ({
			id: c.id,
			milestoneId: c.milestoneId,
			authorName: c.authorName,
			content: c.content,
			createdAt: c.createdAt.toISOString(),
			reactions: commentReactionsByComment[c.id] || {}
		})),
		user: locals.user ? {
			id: locals.user.id,
			email: locals.user.email,
			displayName: userDisplayName,
			canComment: canComment(locals.user.roles),
			canReact: canReact(locals.user.roles)
		} : null
	};
};

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(303, `/login?redirectTo=/entry/${params.id}`);
		}

		if (!canComment(locals.user.roles)) {
			return fail(403, { error: 'You do not have permission to post comments', content: '' });
		}

		const formData = await request.formData();
		const content = formData.get('content')?.toString().trim();

		if (!content) {
			return fail(400, { error: 'Comment is required', content: '' });
		}

		// Get author name from profile or email
		const profile = await db
			.select()
			.from(userProfile)
			.where(eq(userProfile.userId, locals.user.id))
			.get();
		
		const authorName = profile?.firstName 
			? (profile.lastName ? `${profile.firstName} ${profile.lastName}` : profile.firstName)
			: locals.user.email;

		// Save comment to database
		await db.insert(comment).values({
			id: nanoid(),
			milestoneId: params.id,
			userId: locals.user.id,
			authorName,
			content,
			createdAt: new Date()
		});

		return { success: true };
	}
};
