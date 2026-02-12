import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { segment, milestone, milestoneMedia, group, milestoneGroup, videoJob, uploadSession } from '$lib/server/db/schema';
import { asc, eq, desc, max, and, inArray } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { readdir, unlink, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { queueNotification } from '$lib/server/notifications';

const DATA_DIR = process.env.DATA_DIR || 'data';
const UPLOADS_DIR = join(process.cwd(), DATA_DIR, 'uploads');

// Helper to delete a file from a /api/uploads/... URL
async function deleteFileFromUrl(url: string | null): Promise<void> {
	if (!url || !url.startsWith('/api/uploads/')) return;
	const filename = url.replace('/api/uploads/', '');
	const filePath = join(UPLOADS_DIR, filename);
	try {
		await unlink(filePath);
	} catch {
		// File may not exist or already deleted - ignore
	}
}

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
			published: milestone.published,
			sortOrder: milestone.sortOrder
		})
		.from(milestone)
		.orderBy(desc(milestone.date), asc(milestone.sortOrder));

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
		// Sort segments by creation date (newest first)
		.sort((a, b) => {
			const aDate = a.segment.createdAt?.getTime() ?? 0;
			const bDate = b.segment.createdAt?.getTime() ?? 0;
			return bDate - aDate;
		});

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

	// Get all groups for the group picker
	const groups = await db.select().from(group).orderBy(group.name);

	// Get milestone-group assignments
	const milestoneGroupAssignments = await db
		.select({
			milestoneId: milestoneGroup.milestoneId,
			groupId: milestoneGroup.groupId
		})
		.from(milestoneGroup);

	return {
		segments,
		groupedEntries,
		availableImages,
		groups,
		milestoneGroupAssignments
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

		// Queue notification for new published milestone
		const [segmentData] = await db
			.select({ name: segment.name })
			.from(segment)
			.where(eq(segment.id, segmentId));

		console.log('📧 Queueing notification for milestone:', milestoneId, title);
		
		queueNotification(
			'new_milestones',
			`milestone:${milestoneId}`,
			{
				milestoneId,
				milestoneTitle: title,
				segmentName: segmentData?.name ?? 'Updates'
			}
		).then(() => console.log('✅ Notification queued successfully'))
		.catch(err => console.error('❌ Failed to queue milestone notification:', err));

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
		const groupIdsJson = formData.get('groupIds') as string;

		if (!milestoneId || !segmentId || !title || !dateStr) {
			return fail(400, { error: 'All fields are required' });
		}

		// Check if milestone is being published for the first time
		const [existingMilestone] = await db
			.select({ published: milestone.published })
			.from(milestone)
			.where(eq(milestone.id, milestoneId));

		const isFirstPublish = published && existingMilestone && !existingMilestone.published;

		// Parse meta JSON
		let meta: { type: 'coordinates' | 'link' | 'icon'; value: string; label?: string; icon?: string }[] = [];
		if (metaJson) {
			try {
				meta = JSON.parse(metaJson);
			} catch {
				// Ignore invalid JSON
			}
		}

		// Parse group IDs
		let groupIds: string[] = [];
		if (groupIdsJson) {
			try {
				groupIds = JSON.parse(groupIdsJson);
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

		// Update milestone-group assignments
		// First, delete all existing assignments for this milestone
		await db.delete(milestoneGroup).where(eq(milestoneGroup.milestoneId, milestoneId));
		
		// Then, insert new assignments
		for (const groupId of groupIds) {
			await db.insert(milestoneGroup).values({
				id: randomUUID(),
				milestoneId,
				groupId
			});
		}

		// Queue notification if this is the first time publishing
		if (isFirstPublish) {
			console.log('📧 Queueing/extending new_milestones notification for:', milestoneId);
			
			// Use shared groupKey - debounces multiple publishes into one notification
			queueNotification(
				'new_milestones',
				'new_milestones', // Shared key for all new milestone batches
				{ triggered: new Date().toISOString() } // Worker will query fresh data
			).then(() => console.log('✅ Notification queued/extended successfully'))
			.catch(err => console.error('❌ Failed to queue milestone notification:', err));
		}

		// Note: Individual unpublish doesn't cancel the batch notification
		// The worker will query fresh data and only include published milestones

		return { success: true, message: 'Entry updated!' };
	},

	deleteMilestone: async ({ request }) => {
		const formData = await request.formData();
		const milestoneId = formData.get('milestoneId') as string;

		// Fetch all media for this milestone before deleting
		const mediaToDelete = await db
			.select()
			.from(milestoneMedia)
			.where(eq(milestoneMedia.milestoneId, milestoneId));

		// Get video job IDs to clean up their input files
		const videoJobIds = mediaToDelete
			.filter(m => m.videoJobId)
			.map(m => m.videoJobId as string);

		// Fetch video jobs to get input paths
		if (videoJobIds.length > 0) {
			const jobs = await db
				.select({ inputPath: videoJob.inputPath })
				.from(videoJob)
				.where(inArray(videoJob.id, videoJobIds));

			// Delete video job input files (original uploaded videos)
			for (const job of jobs) {
				try {
					if (existsSync(job.inputPath)) {
						await unlink(job.inputPath);
					}
				} catch {
					// Ignore - file may already be deleted
				}
			}

			// Delete video job records
			await db.delete(videoJob).where(inArray(videoJob.id, videoJobIds));
		}

		// Delete physical media files
		for (const media of mediaToDelete) {
			await deleteFileFromUrl(media.url);
			await deleteFileFromUrl(media.thumbnailUrl);
		}

		// Clean up upload session chunks for this milestone
		const sessions = await db
			.select({ id: uploadSession.id })
			.from(uploadSession)
			.where(eq(uploadSession.milestoneId, milestoneId));

		for (const session of sessions) {
			const chunkDir = join(UPLOADS_DIR, 'chunks', session.id);
			try {
				if (existsSync(chunkDir)) {
					await rm(chunkDir, { recursive: true });
				}
			} catch {
				// Ignore cleanup errors
			}
		}

		// Delete upload sessions (should cascade, but be explicit)
		await db.delete(uploadSession).where(eq(uploadSession.milestoneId, milestoneId));

		// Note: No need to cancel notification - worker queries fresh data

		// Delete milestone (cascades to media records)
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

			// Delete physical files
			await deleteFileFromUrl(media.url);
			await deleteFileFromUrl(media.thumbnailUrl);
		}

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

		// Get milestone details before publishing
		const [milestoneData] = await db
			.select({
				id: milestone.id,
				title: milestone.title,
				segmentId: milestone.segmentId,
				published: milestone.published
			})
			.from(milestone)
			.where(eq(milestone.id, milestoneId));

		if (!milestoneData) {
			return fail(404, { error: 'Milestone not found' });
		}

		// Only send notifications if this is the first time publishing
		const wasUnpublished = !milestoneData.published;

		await db
			.update(milestone)
			.set({ published: true })
			.where(eq(milestone.id, milestoneId));

		// Send notification to subscribers (only on first publish)
		if (wasUnpublished) {
			const [segmentData] = await db
				.select({ name: segment.name })
				.from(segment)
				.where(eq(segment.id, milestoneData.segmentId));

			// Queue notification with 5-minute delay
			// This allows cancellation if the milestone is unpublished quickly
			queueNotification(
				'new_milestones',
				`milestone:${milestoneData.id}`, // groupKey for cancellation
				{
					milestoneId: milestoneData.id,
					milestoneTitle: milestoneData.title,
					segmentName: segmentData?.name ?? 'Updates'
				}
			).catch(err => console.error('Failed to queue milestone notification:', err));
		}

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

		// Note: No need to cancel notification - worker queries fresh data

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

			// Get milestone ID from first item for cache invalidation
			let milestoneId: string | undefined;
			if (order.length > 0) {
				const m = await db
					.select({ milestoneId: milestoneMedia.milestoneId })
					.from(milestoneMedia)
					.where(eq(milestoneMedia.id, order[0].id))
					.get();
				milestoneId = m?.milestoneId;
			}

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
	},

	reorderMilestones: async ({ request }) => {
		const formData = await request.formData();
		const orderJson = formData.get('order') as string;

		if (!orderJson) {
			return fail(400, { error: 'Order data is required' });
		}

		try {
			const order = JSON.parse(orderJson) as Array<{ id: string; sortOrder: number }>;

			for (const item of order) {
				await db
					.update(milestone)
					.set({ sortOrder: item.sortOrder })
					.where(eq(milestone.id, item.id));
			}

			return { success: true, message: 'Entries reordered!' };
		} catch {
			return fail(400, { error: 'Invalid order data' });
		}
	}
};
