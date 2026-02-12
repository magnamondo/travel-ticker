/**
 * Notification Queue Functions
 * 
 * These are called from the main app to queue notifications.
 * The notification-worker.ts handles the actual sending.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notificationQueue } from '$lib/server/db/schema';

// Default delay before sending (5 minutes) - allows batching window
const DEFAULT_DELAY_MS = 5 * 60 * 1000;

// Max delay for exponential backoff (4 hours)
const MAX_DELAY_MS = 4 * 60 * 60 * 1000;

/**
 * Calculate exponential backoff delay.
 * Base: 5min, then 10min, 20min, 40min, 80min, capped at 4 hours.
 */
function calculateBackoffDelay(baseDelayMs: number, extensionCount: number): number {
	const multiplier = Math.pow(2, extensionCount);
	return Math.min(baseDelayMs * multiplier, MAX_DELAY_MS);
}

/**
 * Queue a notification for delayed sending.
 * If a pending notification with the same groupKey exists, extends its delay with exponential backoff.
 * Returns the queue entry ID.
 */
export async function queueNotification<T>(
	typeId: string,
	groupKey: string,
	payload: T,
	options?: {
		delayMs?: number; // Custom base delay (default: 5 minutes)
		useExponentialBackoff?: boolean; // Enable exponential backoff for extensions (default: false for milestones, true for comments)
	}
): Promise<string> {
	const now = new Date();
	const baseDelayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
	const useBackoff = options?.useExponentialBackoff ?? false;

	// Check for existing pending notification with same groupKey
	const [existing] = await db
		.select({ 
			id: notificationQueue.id,
			extensionCount: notificationQueue.extensionCount
		})
		.from(notificationQueue)
		.where(
			and(
				eq(notificationQueue.groupKey, groupKey),
				eq(notificationQueue.status, 'pending')
			)
		)
		.limit(1);

	if (existing) {
		// Calculate delay with optional exponential backoff
		const newExtensionCount = (existing.extensionCount ?? 0) + 1;
		const delayMs = useBackoff 
			? calculateBackoffDelay(baseDelayMs, newExtensionCount)
			: baseDelayMs;
		const sendAfter = new Date(now.getTime() + delayMs);

		// Extend the existing notification's send time
		await db
			.update(notificationQueue)
			.set({ 
				sendAfter,
				extensionCount: newExtensionCount
			})
			.where(eq(notificationQueue.id, existing.id));
		
		console.log(`📧 Extended notification ${existing.id} (#${newExtensionCount}), send after ${sendAfter.toISOString()} (${Math.round(delayMs / 60000)}min)`);
		return existing.id;
	}

	// Create new notification
	const id = crypto.randomUUID();
	const sendAfter = new Date(now.getTime() + baseDelayMs);
	
	await db.insert(notificationQueue).values({
		id,
		typeId,
		groupKey,
		payload: payload as Record<string, unknown>,
		status: 'pending',
		sendAfter,
		extensionCount: 0,
		createdAt: now
	});

	console.log(`📧 Created new notification ${id}, send after ${sendAfter.toISOString()}`);
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
