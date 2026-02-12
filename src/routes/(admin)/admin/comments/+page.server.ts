import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { comment, milestone, segment, userProfile, user } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	// Fetch all comments with related milestone, user and profile info
	const commentsWithProfiles = await db
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
			isHidden: comment.isHidden,
			profileFirstName: userProfile.firstName,
			profileLastName: userProfile.lastName,
			userEmail: user.email
		})
		.from(comment)
		.innerJoin(milestone, eq(comment.milestoneId, milestone.id))
		.innerJoin(segment, eq(milestone.segmentId, segment.id))
		.leftJoin(user, eq(comment.userId, user.id))
		.leftJoin(userProfile, eq(comment.userId, userProfile.userId))
		.orderBy(desc(comment.createdAt));

	return {
		comments: commentsWithProfiles.map(c => ({
			id: c.id,
			milestoneId: c.milestoneId,
			milestoneTitle: c.milestoneTitle,
			segmentName: c.segmentName,
			segmentIcon: c.segmentIcon,
			userId: c.userId,
			// Dynamic display name: profile name > email > stored authorName (fallback)
			authorName: c.profileFirstName
				? (c.profileLastName ? `${c.profileFirstName} ${c.profileLastName}` : c.profileFirstName)
				: (c.userEmail ?? c.authorName),
			userEmail: c.userEmail ?? null,
			content: c.content,
			createdAt: c.createdAt.toISOString(),
			updatedAt: c.updatedAt?.toISOString() ?? null,
			isHidden: c.isHidden
		}))
	};
};
