/**
 * Notification Queue Functions
 * 
 * These are called from the main app to queue notifications.
 * The notification-worker.ts handles the actual sending.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notificationQueue } from '$lib/server/db/schema';

// Default delay before sending (5 minutes) - allows cancellation
const DEFAULT_DELAY_MS = 5 * 60 * 1000;

/**
 * Queue a notification for delayed sending.
 * Returns the queue entry ID for potential cancellation.
 */
export async function queueNotification<T>(
	typeId: string,
	groupKey: string,
	payload: T,
	options?: {
		delayMs?: number; // Custom delay (default: 5 minutes)
	}
): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date();
	const delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
	const sendAfter = new Date(now.getTime() + delayMs);

	await db.insert(notificationQueue).values({
		id,
		typeId,
		groupKey,
		payload: payload as Record<string, unknown>,
		status: 'pending',
		sendAfter,
		createdAt: now
	});

	return id;
}

/**
 * Cancel pending notifications by group key.
 * Use this when an action is undone (e.g., reaction removed, unpublished).
 */
export async function cancelNotification(groupKey: string): Promise<number> {
	const result = await db
		.update(notificationQueue)
		.set({ status: 'cancelled' })
		.where(
			and(
				eq(notificationQueue.groupKey, groupKey),
				eq(notificationQueue.status, 'pending')
			)
		);

	return result.changes;
}

/**
 * Cancel a specific notification by ID.
 */
export async function cancelNotificationById(id: string): Promise<boolean> {
	const result = await db
		.update(notificationQueue)
		.set({ status: 'cancelled' })
		.where(
			and(
				eq(notificationQueue.id, id),
				eq(notificationQueue.status, 'pending')
			)
		);

	return result.changes > 0;
}
