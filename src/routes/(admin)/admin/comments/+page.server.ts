import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { comment, milestone, segment, userProfile, user } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	// Fetch all comments with related milestone and user info
	const comments = await db
		.select({
			id: comment.id,
			milestoneId: comment.milestoneId,
			milestoneTitle: milestone.title,
			segmentName: segment.name,
			segmentIcon: segment.icon,
			userId: comment.userId,
			authorName: comment.authorName,
			content: comment.content,
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt,
			isHidden: comment.isHidden
		})
		.from(comment)
		.innerJoin(milestone, eq(comment.milestoneId, milestone.id))
		.innerJoin(segment, eq(milestone.segmentId, segment.id))
		.orderBy(desc(comment.createdAt));

	// Get user emails for comments with userId
	const userIds = [...new Set(comments.filter(c => c.userId).map(c => c.userId!))];
	const users = userIds.length > 0 
		? await db.select({ id: user.id, email: user.email }).from(user)
		: [];
	const userEmailMap = new Map(users.map(u => [u.id, u.email]));

	return {
		comments: comments.map(c => ({
			...c,
			userEmail: c.userId ? userEmailMap.get(c.userId) ?? null : null,
			createdAt: c.createdAt.toISOString(),
			updatedAt: c.updatedAt?.toISOString() ?? null
		}))
	};
};
