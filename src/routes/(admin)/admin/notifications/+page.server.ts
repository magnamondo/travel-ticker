import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { notificationQueue, userProfile, milestone } from '$lib/server/db/schema';
import { desc, eq, sql, inArray } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ url }) => {
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
	const offset = (page - 1) * PAGE_SIZE;

	// Get paginated notifications
	const notifications = await db.select()
		.from(notificationQueue)
		.orderBy(desc(notificationQueue.createdAt))
		.limit(PAGE_SIZE)
		.offset(offset);

	// Get stats using SQL count for efficiency
	const statsResult = await db.select({
		total: sql<number>`count(*)`,
		pending: sql<number>`count(*) filter (where ${notificationQueue.status} = 'pending')`,
		cancelled: sql<number>`count(*) filter (where ${notificationQueue.status} = 'cancelled')`,
		sent: sql<number>`count(*) filter (where ${notificationQueue.status} = 'sent')`,
		failed: sql<number>`count(*) filter (where ${notificationQueue.status} = 'failed')`,
		skipped: sql<number>`count(*) filter (where ${notificationQueue.status} = 'skipped')`
	}).from(notificationQueue);

	const stats = statsResult[0] ?? { total: 0, pending: 0, cancelled: 0, sent: 0, failed: 0, skipped: 0 };
	const totalPages = Math.ceil(stats.total / PAGE_SIZE);

	// Get subscriber count (users with new_milestones preference enabled)
	const subscriberResult = await db.select({
		count: sql<number>`count(*)`
	}).from(userProfile).where(
		sql`json_extract(${userProfile.notificationPreferences}, '$.new_milestones') = 1`
	);
	const subscriberCount = subscriberResult[0]?.count ?? 0;

	// Get count of milestones pending notification (published but not yet notified)
	const pendingMilestonesResult = await db.select({
		count: sql<number>`count(*)`
	}).from(milestone).where(
		sql`${milestone.published} = 1 AND ${milestone.notifiedAt} IS NULL`
	);
	const pendingMilestones = pendingMilestonesResult[0]?.count ?? 0;

	return {
		notifications,
		stats,
		pagination: {
			page,
			pageSize: PAGE_SIZE,
			totalPages,
			total: stats.total
		},
		recipientInfo: {
			subscriberCount,
			pendingMilestones
		}
	};
};

export const actions: Actions = {
	delete: async ({ request }) => {
		const formData = await request.formData();
		const notificationId = formData.get('notificationId') as string;

		if (!notificationId) {
			return fail(400, { error: 'Notification ID required' });
		}

		await db.delete(notificationQueue).where(eq(notificationQueue.id, notificationId));

		return { success: true, message: 'Notification deleted' };
	},

	deleteAll: async ({ request }) => {
		const formData = await request.formData();
		const status = formData.get('status') as string;

		if (status === 'sent') {
			await db.delete(notificationQueue).where(eq(notificationQueue.status, 'sent'));
		} else if (status === 'cancelled') {
			await db.delete(notificationQueue).where(eq(notificationQueue.status, 'cancelled'));
		} else if (status === 'failed') {
			await db.delete(notificationQueue).where(eq(notificationQueue.status, 'failed'));
		} else if (status === 'skipped') {
			await db.delete(notificationQueue).where(eq(notificationQueue.status, 'skipped'));
		} else if (status === 'all') {
			await db.delete(notificationQueue);
		}

		return { success: true, message: 'Notifications deleted' };
	},

	cancel: async ({ request }) => {
		const formData = await request.formData();
		const notificationId = formData.get('notificationId') as string;

		if (!notificationId) {
			return fail(400, { error: 'Notification ID required' });
		}

		await db.update(notificationQueue)
			.set({ status: 'cancelled' })
			.where(eq(notificationQueue.id, notificationId));

		return { success: true, message: 'Notification cancelled' };
	},

	retry: async ({ request }) => {
		const formData = await request.formData();
		const notificationId = formData.get('notificationId') as string;

		if (!notificationId) {
			return fail(400, { error: 'Notification ID required' });
		}

		// Get the notification to access its payload
		const [notification] = await db.select()
			.from(notificationQueue)
			.where(eq(notificationQueue.id, notificationId))
			.limit(1);

		if (!notification) {
			return fail(404, { error: 'Notification not found' });
		}

		// For milestone notifications, reset the notifiedAt so worker will find them again
		if (notification.typeId === 'new_milestones') {
			const payload = notification.payload as { milestoneId?: string };
			if (payload.milestoneId) {
				// Reset this specific milestone's notifiedAt
				await db.update(milestone)
					.set({ notifiedAt: null })
					.where(eq(milestone.id, payload.milestoneId));
			}
		}

		await db.update(notificationQueue)
			.set({ 
				status: 'pending', 
				error: null,
				sendAfter: new Date() // send immediately
			})
			.where(eq(notificationQueue.id, notificationId));

		return { success: true, message: 'Notification queued for retry' };
	}
};
