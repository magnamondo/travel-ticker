import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { milestone, milestoneMedia } from '$lib/server/db/schema';
import { eq, asc, and } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';
import { randomUUID } from 'crypto';

export const load: PageServerLoad = async ({ params }) => {
	const [found] = await db.select().from(milestone).where(eq(milestone.id, params.id));

	if (!found) {
		throw error(404, 'Milestone not found');
	}

	const media = await db
		.select()
		.from(milestoneMedia)
		.where(eq(milestoneMedia.milestoneId, params.id))
		.orderBy(asc(milestoneMedia.sortOrder));

	return {
		milestone: found,
		media
	};
};

export const actions: Actions = {
	add: async ({ request, params }) => {
		const formData = await request.formData();
		const type = formData.get('type') as 'image' | 'video';
		const url = formData.get('url') as string;
		const thumbnailUrl = formData.get('thumbnailUrl') as string;
		const caption = formData.get('caption') as string;

		if (!type || !url) {
			return fail(400, { error: 'Type and URL are required' });
		}

		// Check for duplicate URL in this milestone
		const [duplicate] = await db
			.select()
			.from(milestoneMedia)
			.where(and(eq(milestoneMedia.milestoneId, params.id), eq(milestoneMedia.url, url)));

		if (duplicate) {
			// Already exists, skip insertion
			return { success: true, skipped: true };
		}

		// Get max sort order
		const existing = await db
			.select()
			.from(milestoneMedia)
			.where(eq(milestoneMedia.milestoneId, params.id));

		const maxOrder = existing.reduce((max, m) => Math.max(max, m.sortOrder), -1);

		await db.insert(milestoneMedia).values({
			id: randomUUID(),
			milestoneId: params.id,
			type,
			url,
			thumbnailUrl: thumbnailUrl || null,
			caption: caption || null,
			sortOrder: maxOrder + 1,
			createdAt: new Date()
		});

		return { success: true };
	},

	delete: async ({ request }) => {
		const formData = await request.formData();
		const mediaId = formData.get('mediaId') as string;

		await db.delete(milestoneMedia).where(eq(milestoneMedia.id, mediaId));

		return { success: true };
	}
};
