import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { milestone, milestoneMedia, videoJob } from '$lib/server/db/schema';
import { eq, asc, and } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || 'data';
const UPLOADS_DIR = join(process.cwd(), DATA_DIR, 'uploads');

async function deleteFileFromUrl(url: string | null): Promise<void> {
	if (!url || !url.startsWith('/api/uploads/')) return;
	const filename = url.replace('/api/uploads/', '');
	try {
		await unlink(join(UPLOADS_DIR, filename));
	} catch {
		// File may not exist - ignore
	}
}

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

		// Fetch media record before deleting to get file URLs
		const [media] = await db
			.select()
			.from(milestoneMedia)
			.where(eq(milestoneMedia.id, mediaId));

		if (media) {
			// Delete video job and its input file if exists
			if (media.videoJobId) {
				const [job] = await db
					.select({ inputPath: videoJob.inputPath })
					.from(videoJob)
					.where(eq(videoJob.id, media.videoJobId));

				if (job) {
					try {
						if (existsSync(job.inputPath)) {
							await unlink(job.inputPath);
						}
					} catch {
						// Ignore - file may already be deleted
					}
					await db.delete(videoJob).where(eq(videoJob.id, media.videoJobId));
				}
			}

			await deleteFileFromUrl(media.url);
			await deleteFileFromUrl(media.thumbnailUrl);
		}

		await db.delete(milestoneMedia).where(eq(milestoneMedia.id, mediaId));

		return { success: true };
	}
};
