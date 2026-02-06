import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { segment, milestone, milestoneMedia } from '$lib/server/db/schema';
import { asc, eq, desc, sql, max } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { readdir } from 'fs/promises';
import { join } from 'path';

export const load: PageServerLoad = async () => {
	const segments = await db.select().from(segment).orderBy(asc(segment.sortOrder));

	// Get all milestones (including unpublished drafts for admin)
	const milestones = await db
		.select({
			id: milestone.id,
			segmentId: milestone.segmentId,
			title: milestone.title,
			description: milestone.description,
			date: milestone.date,
			avatar: milestone.avatar,
			meta: milestone.meta,
			published: milestone.published
		})
		.from(milestone)
		.orderBy(desc(milestone.createdAt));

	// Get all media (worker updates milestone_media directly with final URLs)
	const allMedia = await db
		.select()
		.from(milestoneMedia)
		.orderBy(asc(milestoneMedia.sortOrder));

	// Group media by milestone
	const mediaByMilestone = new Map<string, typeof allMedia>();
	for (const m of allMedia) {
		if (!mediaByMilestone.has(m.milestoneId)) {
			mediaByMilestone.set(m.milestoneId, []);
		}
		mediaByMilestone.get(m.milestoneId)!.push(m);
	}

	// Group milestones by segment
	const groupedEntries = segments
		.map((seg) => ({
			segment: seg,
			milestones: milestones
				.filter((m) => m.segmentId === seg.id)
				.map((m) => ({
					...m,
					media: mediaByMilestone.get(m.id) || []
				}))
		}))
		.filter((group) => group.milestones.length > 0 || segments.length <= 5);

	// Get all uploaded images for avatar picker
	const uploadsDir = join(process.cwd(), 'data', 'uploads');
	let availableImages: string[] = [];
	try {
		const files = await readdir(uploadsDir);
		availableImages = files
			.filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f))
			.map(f => `/api/uploads/${f}`);
	} catch {
		// uploads directory may not exist yet
	}

	return {
		segments,
		groupedEntries,
		availableImages
	};
};

export const actions: Actions = {
	addMilestone: async ({ request }) => {
		const formData = await request.formData();
		const segmentId = formData.get('segmentId') as string;
		const title = formData.get('title') as string;
		const description = formData.get('description') as string;
		const dateStr = formData.get('date') as string;
		const avatar = formData.get('avatar') as string;
		const mediaJson = formData.get('media') as string;

		if (!segmentId || !title || !dateStr) {
			return fail(400, { error: 'Segment, title, and date are required' });
		}

		const milestoneId = randomUUID();

		await db.insert(milestone).values({
			id: milestoneId,
			segmentId,
			title,
			description: description || null,
			date: new Date(dateStr),
			avatar: avatar || null,
			published: true,
			createdAt: new Date()
		});

		// Add media if provided
		if (mediaJson) {
			try {
				const mediaItems = JSON.parse(mediaJson) as Array<{
					type: 'image' | 'video';
					url: string;
					thumbnailUrl: string;
					caption: string;
					videoJobId?: string;
				}>;

				for (let i = 0; i < mediaItems.length; i++) {
					const item = mediaItems[i];
					if (item.url) {
						await db.insert(milestoneMedia).values({
							id: randomUUID(),
							milestoneId,
							type: item.type,
							url: item.url,
							thumbnailUrl: item.thumbnailUrl || null,
							caption: item.caption || null,
							videoJobId: item.videoJobId || null,
							sortOrder: i,
							createdAt: new Date()
						});
					}
				}
			} catch {
				// Ignore JSON parse errors
			}
		}

		return { success: true, message: 'Entry added!' };
	},

	updateMilestone: async ({ request }) => {
		const formData = await request.formData();
		const milestoneId = formData.get('milestoneId') as string;
		const segmentId = formData.get('segmentId') as string;
		const title = formData.get('title') as string;
		const description = formData.get('description') as string;
		const dateStr = formData.get('date') as string;
		const metaJson = formData.get('meta') as string;
		const published = formData.get('published') === 'on';

		if (!milestoneId || !segmentId || !title || !dateStr) {
			return fail(400, { error: 'All fields are required' });
		}

		// Parse meta JSON
		let meta: { type: 'coordinates' | 'link' | 'icon'; value: string; label?: string; icon?: string }[] = [];
		if (metaJson) {
			try {
				meta = JSON.parse(metaJson);
			} catch {
				// Ignore invalid JSON
			}
		}

		await db
			.update(milestone)
			.set({
				segmentId,
				title,
				description: description || null,
				date: new Date(dateStr),
				meta,
				published
			})
			.where(eq(milestone.id, milestoneId));

		return { success: true, message: 'Entry updated!' };
	},

	deleteMilestone: async ({ request }) => {
		const formData = await request.formData();
		const milestoneId = formData.get('milestoneId') as string;

		await db.delete(milestone).where(eq(milestone.id, milestoneId));

		return { success: true, message: 'Entry deleted!' };
	},

	addSegment: async ({ request }) => {
		const formData = await request.formData();
		const name = formData.get('name') as string;
		const icon = formData.get('icon') as string;
		const sortOrderInput = formData.get('sortOrder') as string;

		if (!name || !icon) {
			return fail(400, { error: 'Name and icon are required' });
		}

		// If sortOrder not provided, get the next sequential value
		let sortOrder: number;
		if (sortOrderInput && sortOrderInput.trim() !== '') {
			sortOrder = parseInt(sortOrderInput) || 0;
		} else {
			const [result] = await db.select({ maxOrder: max(segment.sortOrder) }).from(segment);
			sortOrder = (result?.maxOrder ?? -1) + 1;
		}

		await db.insert(segment).values({
			id: randomUUID(),
			name,
			icon,
			sortOrder,
			createdAt: new Date()
		});

		return { success: true, message: 'Segment created!' };
	},

	updateSegment: async ({ request }) => {
		const formData = await request.formData();
		const segmentId = formData.get('segmentId') as string;
		const name = formData.get('name') as string;
		const icon = formData.get('icon') as string;
		const sortOrder = parseInt(formData.get('sortOrder') as string) || 0;

		if (!segmentId || !name || !icon) {
			return fail(400, { error: 'Name and icon are required' });
		}

		await db
			.update(segment)
			.set({
				name,
				icon,
				sortOrder
			})
			.where(eq(segment.id, segmentId));

		return { success: true, message: 'Segment updated!' };
	},

	deleteSegment: async ({ request }) => {
		const formData = await request.formData();
		const segmentId = formData.get('segmentId') as string;

		// Check if segment has milestones
		const milestones = await db
			.select()
			.from(milestone)
			.where(eq(milestone.segmentId, segmentId));

		if (milestones.length > 0) {
			return fail(400, { error: 'Cannot delete segment with entries. Delete entries first.' });
		}

		await db.delete(segment).where(eq(segment.id, segmentId));

		return { success: true, message: 'Segment deleted!' };
	},

	addMedia: async ({ request }) => {
		const formData = await request.formData();
		const milestoneId = formData.get('milestoneId') as string;
		const type = formData.get('type') as 'image' | 'video';
		const url = formData.get('url') as string;
		const thumbnailUrl = formData.get('thumbnailUrl') as string;
		const caption = formData.get('caption') as string;
		const videoJobId = formData.get('videoJobId') as string;

		if (!milestoneId || !type || !url) {
			return fail(400, { error: 'Type and URL are required' });
		}

		// Get max sort order
		const existing = await db
			.select()
			.from(milestoneMedia)
			.where(eq(milestoneMedia.milestoneId, milestoneId));

		const maxOrder = existing.reduce((max, m) => Math.max(max, m.sortOrder), -1);

		await db.insert(milestoneMedia).values({
			id: randomUUID(),
			milestoneId,
			type,
			url,
			thumbnailUrl: thumbnailUrl || null,
			caption: caption || null,
			videoJobId: videoJobId || null,
			sortOrder: maxOrder + 1,
			createdAt: new Date()
		});

		return { success: true, message: 'Media added!' };
	},

	deleteMedia: async ({ request }) => {
		const formData = await request.formData();
		const mediaId = formData.get('mediaId') as string;

		await db.delete(milestoneMedia).where(eq(milestoneMedia.id, mediaId));

		return { success: true, message: 'Media deleted!' };
	},

	createDraft: async ({ request }) => {
		const formData = await request.formData();
		const segmentId = formData.get('segmentId') as string;

		if (!segmentId) {
			return fail(400, { error: 'Segment is required' });
		}

		const milestoneId = randomUUID();

		await db.insert(milestone).values({
			id: milestoneId,
			segmentId,
			title: '',
			description: null,
			date: new Date(),
			avatar: null,
			published: false,
			createdAt: new Date()
		});

		return { success: true, milestoneId, message: 'Draft created!' };
	},

	publishMilestone: async ({ request }) => {
		const formData = await request.formData();
		const milestoneId = formData.get('milestoneId') as string;

		if (!milestoneId) {
			return fail(400, { error: 'Milestone ID is required' });
		}

		await db
			.update(milestone)
			.set({ published: true })
			.where(eq(milestone.id, milestoneId));

		return { success: true, message: 'Entry published!' };
	},

	unpublishMilestone: async ({ request }) => {
		const formData = await request.formData();
		const milestoneId = formData.get('milestoneId') as string;

		if (!milestoneId) {
			return fail(400, { error: 'Milestone ID is required' });
		}

		await db
			.update(milestone)
			.set({ published: false })
			.where(eq(milestone.id, milestoneId));

		return { success: true, message: 'Entry unpublished!' };
	},

	reorderMedia: async ({ request }) => {
		const formData = await request.formData();
		const orderJson = formData.get('order') as string;

		if (!orderJson) {
			return fail(400, { error: 'Order data is required' });
		}

		try {
			const order = JSON.parse(orderJson) as Array<{ id: string; sortOrder: number }>;
			
			for (const item of order) {
				await db
					.update(milestoneMedia)
					.set({ sortOrder: item.sortOrder })
					.where(eq(milestoneMedia.id, item.id));
			}

			return { success: true, message: 'Media reordered!' };
		} catch {
			return fail(400, { error: 'Invalid order data' });
		}
	}
};
