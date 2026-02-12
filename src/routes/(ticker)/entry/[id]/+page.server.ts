import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { milestone, segment, milestoneMedia, comment, reaction, userProfile, user } from '$lib/server/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { isAdmin, canComment } from '$lib/roles';
import { canUserAccessMilestone } from '$lib/server/groups';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	// Fetch milestone with segment
	const milestoneResult = await db
		.select({
			id: milestone.id,
			title: milestone.title,
			description: milestone.description,
			date: milestone.date,
			avatar: milestone.avatar,
			meta: milestone.meta,
			segmentId: segment.id,
			segmentName: segment.name,
			segmentIcon: segment.icon,
		})
		.from(milestone)
		.innerJoin(segment, eq(milestone.segmentId, segment.id))
		.where(eq(milestone.id, params.id))
		.get();

	if (!milestoneResult) {
		throw error(404, 'Entry not found');
	}

	// Check if user has access to this milestone
	const hasAccess = await canUserAccessMilestone(
		locals.user?.id ?? null,
		milestoneResult.id,
		locals.user?.roles
	);
	if (!hasAccess) {
		throw error(403, 'You do not have access to this entry');
	}

	// Fetch media for milestone
	const media = await db
		.select()
		.from(milestoneMedia)
		.where(eq(milestoneMedia.milestoneId, params.id))
		.orderBy(milestoneMedia.sortOrder);

	// Fetch comments for milestone with user profile info for dynamic display names
	const commentsWithProfiles = await db
		.select({
			id: comment.id,
			milestoneId: comment.milestoneId,
			userId: comment.userId,
			authorName: comment.authorName,
			content: comment.content,
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt,
			isHidden: comment.isHidden,
			profileFirstName: userProfile.firstName,
			profileLastName: userProfile.lastName,
			userEmail: user.email
		})
		.from(comment)
		.leftJoin(user, eq(comment.userId, user.id))
		.leftJoin(userProfile, eq(comment.userId, userProfile.userId))
		.where(eq(comment.milestoneId, params.id));

	// Calculate display name: profile name > email > stored authorName (fallback for deleted users)
	const comments = commentsWithProfiles.map(c => ({
		id: c.id,
		milestoneId: c.milestoneId,
		userId: c.userId,
		authorName: c.profileFirstName
			? (c.profileLastName ? `${c.profileFirstName} ${c.profileLastName}` : c.profileFirstName)
			: (c.userEmail ?? c.authorName),
		content: c.content,
		createdAt: c.createdAt,
		updatedAt: c.updatedAt,
		isHidden: c.isHidden
	}));

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
		origin: url.origin,
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
		comments: comments
			// Filter out hidden comments for non-admins, but allow owners to see their own hidden comments
			.filter(c => !c.isHidden || (locals.user && (isAdmin(locals.user.roles) || c.userId === locals.user.id)))
			.map(c => ({
				id: c.id,
				milestoneId: c.milestoneId,
				userId: c.userId,
				authorName: c.authorName,
				content: c.content,
				createdAt: c.createdAt.toISOString(),
				updatedAt: c.updatedAt?.toISOString() ?? null,
				isHidden: c.isHidden,
				reactions: commentReactionsByComment[c.id] || {}
			})),
		userDisplayName	};
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
		let content = formData.get('content')?.toString().trim();

		if (!content) {
			return fail(400, { error: 'Comment is required', content: '' });
		}

		// Sanitize content:
		// - Strip HTML tags
		// - Limit consecutive line breaks to 2
		content = content
			.replace(/<[^>]*>/g, '')
			.replace(/\n{3,}/g, '\n\n');

		// Check for duplicate submission (same user, same content, within 30 seconds)
		const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
		const existingComment = await db
			.select({ id: comment.id })
			.from(comment)
			.where(
				and(
					eq(comment.milestoneId, params.id),
					eq(comment.userId, locals.user.id),
					eq(comment.content, content),
					gte(comment.createdAt, thirtySecondsAgo)
				)
			)
			.get();

		if (existingComment) {
			return fail(400, { error: 'You already posted this comment', content: '' });
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
