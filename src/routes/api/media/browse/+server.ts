import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { milestoneMedia, milestone } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';
import { isAdmin } from '$lib/roles';

export const GET: RequestHandler = async ({ locals }) => {
	// Only admins can browse all media
	if (!isAdmin(locals.user?.roles)) {
		throw error(403, 'Unauthorized');
	}

	// Get all media from database with milestone info
	const allMedia = await db
		.select({
			id: milestoneMedia.id,
			milestoneId: milestoneMedia.milestoneId,
			type: milestoneMedia.type,
			url: milestoneMedia.url,
			thumbnailUrl: milestoneMedia.thumbnailUrl,
			caption: milestoneMedia.caption,
			duration: milestoneMedia.duration,
			createdAt: milestoneMedia.createdAt,
			milestoneTitle: milestone.title
		})
		.from(milestoneMedia)
		.leftJoin(milestone, eq(milestoneMedia.milestoneId, milestone.id))
		.orderBy(desc(milestoneMedia.createdAt));

	return json({
		media: allMedia.map(m => ({
			id: m.id,
			milestoneId: m.milestoneId,
			type: m.type,
			url: m.url,
			thumbnailUrl: m.thumbnailUrl,
			caption: m.caption,
			duration: m.duration,
			createdAt: m.createdAt,
			milestoneTitle: m.milestoneTitle
		}))
	});
};
