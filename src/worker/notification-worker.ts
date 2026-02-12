/**
 * Notification Worker
 * 
 * Runs as a separate process from the HTTP server.
 * Polls the database for pending notifications and sends emails.
 * 
 * Usage: npx tsx src/worker/notification-worker.ts
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, lte, gte, desc, inArray, sql } from 'drizzle-orm';
import { config } from 'dotenv';
import { Resend } from 'resend';

// Load .env file for local development
config();

// Initialize database connection
const DATABASE_URL = process.env.DATABASE_URL || 'data/db/database.db';
const sqlite = new Database(DATABASE_URL);

sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');

const db = drizzle(sqlite);

// Import schema (inline to avoid SvelteKit imports)
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	roles: text('roles', { mode: 'json' }).$type<string[]>().default([]).notNull()
});

interface NotificationPreferences {
	new_milestones?: boolean;
}

const userProfile = sqliteTable('user_profile', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().unique(),
	firstName: text('first_name'),
	lastName: text('last_name'),
	notificationPreferences: text('notification_preferences', { mode: 'json' })
		.$type<NotificationPreferences>()
		.default({})
});

const notificationQueue = sqliteTable('notification_queue', {
	id: text('id').primaryKey(),
	typeId: text('type_id').notNull(),
	groupKey: text('group_key').notNull(),
	payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
	status: text('status', { enum: ['pending', 'cancelled', 'sent', 'failed', 'skipped'] }).notNull().default('pending'),
	sendAfter: integer('send_after', { mode: 'timestamp' }).notNull(),
	extensionCount: integer('extension_count').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	sentAt: integer('sent_at', { mode: 'timestamp' }),
	error: text('error')
});

const segment = sqliteTable('segment', {
	id: text('id').primaryKey(),
	name: text('name').notNull()
});

const milestone = sqliteTable('milestone', {
	id: text('id').primaryKey(),
	segmentId: text('segment_id').notNull(),
	title: text('title').notNull(),
	published: integer('published', { mode: 'boolean' }).notNull(),
	notifiedAt: integer('notified_at', { mode: 'timestamp' }),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Group restrictions for milestones
const milestoneGroup = sqliteTable('milestone_group', {
	id: text('id').primaryKey(),
	milestoneId: text('milestone_id').notNull(),
	groupId: text('group_id').notNull()
});

// User group memberships
const userGroup = sqliteTable('user_group', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	groupId: text('group_id').notNull()
});

// Configuration
const POLL_INTERVAL = 10000; // 10 seconds
const ORIGIN = process.env.ORIGIN || 'http://localhost:5173';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

let isProcessing = false;
let shouldExit = false;

// Email client
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ============================================================================
// Email Templates
// ============================================================================

interface Recipient {
	email: string;
	firstName?: string | null;
}

// ============================================================================
// New Milestones Email (consolidated)
// ============================================================================

interface MilestoneInfo {
	id: string;
	title: string;
	segmentName: string;
}

function generateNewMilestonesEmail(
	recipient: Recipient,
	milestones: MilestoneInfo[],
	origin: string
): { subject: string; html: string } {
	const greeting = recipient.firstName ? `Hi ${recipient.firstName},` : 'Hi,';
	const count = milestones.length;
	const subject = count === 1 
		? `New update: ${milestones[0].title}`
		: `${count} new updates posted`;
	const logoUrl = `${origin}/logo.jpg`;
	const year = new Date().getFullYear();

	// Generate milestone cards
	const milestoneCards = milestones.map(m => `
		<div style="background-color: #f5f5f5; padding: 16px; border-radius: 8px; margin-bottom: 12px;">
			<a href="${origin}/entry/${m.id}" style="color: #000; text-decoration: none; font-weight: 600; font-size: 16px;">${m.title}</a>
			<p style="margin: 4px 0 0; color: #666; font-size: 13px;">${m.segmentName}</p>
		</div>
	`).join('');

	return {
		subject,
		html: `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; color: #000000; font-family: system-ui, -apple-system, sans-serif;">
	<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; min-height: 100vh;">
		<tr>
			<td align="center" style="padding: 40px 20px;">
				<div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; padding: 40px; text-align: center;">
					<div style="margin-bottom: 30px;">
						<a href="${origin}" style="text-decoration: none; display: inline-block;">
							<img src="${logoUrl}" alt="Magnamondo" width="180" style="display: block; width: 180px; height: auto;" />
						</a>
					</div>
					
					<div style="text-align: left;">
						<p style="color: #333; font-size: 16px; line-height: 1.6;">${greeting}</p>
						
						<p style="color: #333; font-size: 16px; line-height: 1.6;">
							${count === 1 ? 'A new update has been posted:' : `${count} new updates have been posted:`}
						</p>
						
						${milestoneCards}
						
						<div style="text-align: center; margin-top: 24px;">
							<a href="${origin}" style="background-color: #000; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 4px; display: inline-block; font-weight: 600; font-size: 16px;">
								View All Updates
							</a>
						</div>
					</div>
					
					<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666666; font-size: 12px;">
						<p style="margin: 0 0 8px;">
							You're receiving this because you subscribed to new milestone notifications.<br>
							<a href="${origin}/profile" style="color: #666;">Manage preferences</a>
						</p>
						<p style="margin: 0;">&copy; ${year} Magnamondo</p>
					</div>
				</div>
			</td>
		</tr>
	</table>
</body>
</html>`
	};
}

// ============================================================================
// Other Email Generators (comment replies, reactions)
// ============================================================================

type EmailGenerator<T = unknown> = (
	recipient: Recipient,
	data: T,
	origin: string
) => { subject: string; html: string };

// Registry of email generators by notification type (for future use)
const emailGenerators: Map<string, EmailGenerator> = new Map();

// ============================================================================
// Email Sending
// ============================================================================

interface EmailMessage {
	from: string;
	to: string;
	subject: string;
	html: string;
}

const BATCH_SIZE = 100; // Resend batch limit
const FROM_ADDRESS = 'Magnamondo <system@magnamondo.com>';

async function sendEmailBatch(emails: EmailMessage[]): Promise<{ sent: number; failed: number }> {
	if (emails.length === 0) {
		return { sent: 0, failed: 0 };
	}

	if (resend) {
		try {
			// Send in batches of BATCH_SIZE
			let totalSent = 0;
			let totalFailed = 0;

			for (let i = 0; i < emails.length; i += BATCH_SIZE) {
				const batch = emails.slice(i, i + BATCH_SIZE);
				
				const result = await resend.batch.send(batch);
				
				// Count successes and failures from the response
				if (result.data) {
					// Batch response returns array of { id: string } for each sent email
					const sentEmails = result.data.data;
					if (Array.isArray(sentEmails)) {
						totalSent += sentEmails.filter(item => item.id).length;
						totalFailed += sentEmails.filter(item => !item.id).length;
					} else {
						// Fallback: assume all succeeded if we got data back
						totalSent += batch.length;
					}
				} else if (result.error) {
					console.error(`  ❌ Batch send error:`, result.error);
					totalFailed += batch.length;
				}
			}

			return { sent: totalSent, failed: totalFailed };
		} catch (err) {
			console.error(`  ❌ Batch send exception:`, err);
			return { sent: 0, failed: emails.length };
		}
	} else {
		// Mock mode for development
		console.log(`  📧 [MOCK] Batch of ${emails.length} emails:`);
		for (const email of emails.slice(0, 3)) {
			console.log(`     → ${email.to}: ${email.subject}`);
		}
		if (emails.length > 3) {
			console.log(`     ... and ${emails.length - 3} more`);
		}
		return { sent: emails.length, failed: 0 };
	}
}

// ============================================================================
// Queue Processing
// ============================================================================

async function getSubscribers(typeId: string): Promise<Array<{ userId: string; email: string; firstName: string | null }>> {
	// Query users whose notification_preferences JSON has this typeId set to true
	const subscribers = await db
		.select({
			userId: user.id,
			email: user.email,
			firstName: userProfile.firstName
		})
		.from(user)
		.innerJoin(userProfile, eq(user.id, userProfile.userId))
		.where(
			sql`json_extract(${userProfile.notificationPreferences}, ${`$.${typeId}`}) = 1`
		);

	return subscribers;
}

/**
 * Special handler for new_milestones notifications.
 * Queries fresh milestone data and sends consolidated email.
 * Respects group restrictions - only notifies users who can access each milestone.
 */
async function processNewMilestonesNotification(
	queueItems: Array<{ id: string; groupKey: string; createdAt: Date }>
): Promise<void> {
	console.log(`  📬 Processing ${queueItems.length} new_milestones queue item(s)...`);

	// Get all subscribers
	const allSubscribers = await getSubscribers('new_milestones');
	console.log(`  👥 Found ${allSubscribers.length} subscriber(s) with new_milestones enabled`);
	
	if (allSubscribers.length === 0) {
		console.log(`  ⚠️  No subscribers - marking queue items as skipped`);
		// Mark all queue items as skipped (no recipients)
		for (const item of queueItems) {
			await db
				.update(notificationQueue)
				.set({ status: 'skipped', sentAt: new Date(), error: 'No subscribers' })
				.where(eq(notificationQueue.id, item.id));
		}
		return;
	}

	// Find the earliest queue item timestamp - only include milestones created around this time
	// Use a small buffer (1 minute) to handle race conditions between milestone creation and queue insertion
	const earliestQueueTime = queueItems.reduce(
		(min, item) => (item.createdAt < min ? item.createdAt : min),
		queueItems[0].createdAt
	);
	const cutoffTime = new Date(earliestQueueTime.getTime() - 60 * 1000); // 1 minute buffer

	// Query fresh milestones that haven't been notified yet and were created around queue time
	const newMilestones = await db
		.select({
			id: milestone.id,
			title: milestone.title,
			segmentId: milestone.segmentId
		})
		.from(milestone)
		.where(
			and(
				eq(milestone.published, true),
				sql`${milestone.notifiedAt} IS NULL`,
				gte(milestone.createdAt, cutoffTime)
			)
		)
		.orderBy(desc(milestone.createdAt));

	console.log(`  📝 Found ${newMilestones.length} unnotified milestone(s) created after ${cutoffTime.toISOString()}`);
	
	if (newMilestones.length === 0) {
		console.log(`  ⚠️  No milestones to notify about - marking queue items as skipped`);
		// Mark all queue items as skipped (milestones already notified or unpublished)
		for (const item of queueItems) {
			await db
				.update(notificationQueue)
				.set({ status: 'skipped', sentAt: new Date(), error: 'No unnotified milestones found' })
				.where(eq(notificationQueue.id, item.id));
		}
		return;
	}

	// Get group restrictions for each milestone
	const milestoneIds = newMilestones.map(m => m.id);
	const groupRestrictions = await db
		.select({
			milestoneId: milestoneGroup.milestoneId,
			groupId: milestoneGroup.groupId
		})
		.from(milestoneGroup)
		.where(inArray(milestoneGroup.milestoneId, milestoneIds));

	// Build map: milestoneId -> Set of allowed groupIds (empty = public)
	const milestoneAllowedGroups = new Map<string, Set<string>>();
	for (const m of newMilestones) {
		milestoneAllowedGroups.set(m.id, new Set());
	}
	for (const r of groupRestrictions) {
		milestoneAllowedGroups.get(r.milestoneId)?.add(r.groupId);
	}

	// Get user group memberships for all subscribers
	const subscriberIds = allSubscribers.map(s => s.userId);
	const userGroups = await db
		.select({
			userId: userGroup.userId,
			groupId: userGroup.groupId
		})
		.from(userGroup)
		.where(inArray(userGroup.userId, subscriberIds));

	// Build map: userId -> Set of groupIds
	const userGroupMap = new Map<string, Set<string>>();
	for (const ug of userGroups) {
		if (!userGroupMap.has(ug.userId)) {
			userGroupMap.set(ug.userId, new Set());
		}
		userGroupMap.get(ug.userId)!.add(ug.groupId);
	}

	// Get segment names
	const segmentIds = [...new Set(newMilestones.map(m => m.segmentId))];
	const segments = await db
		.select({ id: segment.id, name: segment.name })
		.from(segment)
		.where(inArray(segment.id, segmentIds));
	
	const segmentMap = new Map(segments.map(s => [s.id, s.name]));

	// Log milestone group restrictions
	for (const m of newMilestones) {
		const groups = milestoneAllowedGroups.get(m.id)!;
		if (groups.size > 0) {
			console.log(`  🔐 Milestone "${m.title}" restricted to groups: [${[...groups].join(', ')}]`);
		} else {
			console.log(`  🌐 Milestone "${m.title}" is public`);
		}
	}

	// Build per-subscriber email with only milestones they can access
	const emails: EmailMessage[] = [];
	// Track which milestones were actually sent to at least one subscriber
	const milestonesActuallySent = new Set<string>();
	let skippedSubscribers = 0;

	for (const subscriber of allSubscribers) {
		const userGroupIds = userGroupMap.get(subscriber.userId) ?? new Set();
		
		// Filter milestones: include if public (no groups) OR user is in allowed group
		const accessibleMilestones = newMilestones.filter(m => {
			const allowedGroups = milestoneAllowedGroups.get(m.id)!;
			if (allowedGroups.size === 0) {
				// Public milestone - everyone can see
				return true;
			}
			// Check if user is in any of the allowed groups
			for (const gid of allowedGroups) {
				if (userGroupIds.has(gid)) return true;
			}
			return false;
		});

		if (accessibleMilestones.length === 0) {
			// This subscriber can't see any of the new milestones
			console.log(`  ⛔ ${subscriber.email} has no access (user groups: [${[...userGroupIds].join(', ')}])`);
			skippedSubscribers++;
			continue;
		}

		// Track that these milestones will be sent to at least one person
		for (const m of accessibleMilestones) {
			milestonesActuallySent.add(m.id);
		}

		const milestoneInfos: MilestoneInfo[] = accessibleMilestones.map(m => ({
			id: m.id,
			title: m.title,
			segmentName: segmentMap.get(m.segmentId) ?? 'Updates'
		}));

		const { subject, html } = generateNewMilestonesEmail(
			{ email: subscriber.email, firstName: subscriber.firstName },
			milestoneInfos,
			ORIGIN
		);

		emails.push({
			from: FROM_ADDRESS,
			to: subscriber.email,
			subject,
			html
		});
	}

	console.log(`  📊 Result: ${emails.length} email(s) to send, ${skippedSubscribers} subscriber(s) skipped due to access`);

	if (emails.length === 0) {
		// No emails to send - don't mark any milestones as notified!
		// Group-restricted milestones should wait until eligible subscribers exist.
		console.log(`  ⚠️  No emails to send - marking queue items as skipped (milestones NOT marked as notified)`);
		const now = new Date();
		for (const item of queueItems) {
			await db
				.update(notificationQueue)
				.set({ status: 'skipped', sentAt: now, error: 'No eligible recipients (group access)' })
				.where(eq(notificationQueue.id, item.id));
		}
		return;
	}

	// Send batch
	console.log(`  📤 Sending ${emails.length} email(s)...`);
	const { sent, failed } = await sendEmailBatch(emails);
	console.log(`  ✅ Sent: ${sent}, ❌ Failed: ${failed}`);

	const now = new Date();

	// Only mark milestones as notified if they were actually sent to someone
	if (failed < emails.length) {
		const notifiedCount = [...milestonesActuallySent].length;
		console.log(`  📌 Marking ${notifiedCount} milestone(s) as notified`);
		for (const m of newMilestones) {
			if (milestonesActuallySent.has(m.id)) {
				await db
					.update(milestone)
					.set({ notifiedAt: now })
					.where(eq(milestone.id, m.id));
			}
		}
	}

	// Mark queue items as sent/failed
	const status = failed === emails.length ? 'failed' : 'sent';
	const error = failed > 0 ? `${failed}/${emails.length} send failures` : null;
	
	for (const item of queueItems) {
		await db
			.update(notificationQueue)
			.set({ status, sentAt: now, error })
			.where(eq(notificationQueue.id, item.id));
	}
}

async function processQueue(): Promise<void> {
	if (isProcessing) return;
	isProcessing = true;

	try {
		const now = new Date();

		// Get all pending notifications ready to send
		const pendingItems = await db
			.select()
			.from(notificationQueue)
			.where(
				and(
					eq(notificationQueue.status, 'pending'),
					lte(notificationQueue.sendAfter, now)
				)
			);

		if (pendingItems.length === 0) {
			isProcessing = false;
			return;
		}

		// Group by typeId for efficient subscriber lookup
		const byType = new Map<string, typeof pendingItems>();
		for (const item of pendingItems) {
			const existing = byType.get(item.typeId) ?? [];
			existing.push(item);
			byType.set(item.typeId, existing);
		}

		for (const [typeId, items] of byType) {
			// Special handling for new_milestones - query fresh data
			if (typeId === 'new_milestones') {
				await processNewMilestonesNotification(items);
				continue;
			}

			// Generic handling for other notification types
			const generator = emailGenerators.get(typeId);
			if (!generator) {
				console.warn(`  ⚠️  No email generator for type: ${typeId}`);
				for (const item of items) {
					await db
						.update(notificationQueue)
						.set({ status: 'failed', error: 'No email generator registered' })
						.where(eq(notificationQueue.id, item.id));
				}
				continue;
			}

			// Get subscribers for this notification type
			const subscribers = await getSubscribers(typeId);
			if (subscribers.length === 0) {
				// Mark as skipped (no one to notify)
				for (const item of items) {
					await db
						.update(notificationQueue)
						.set({ status: 'skipped', sentAt: new Date(), error: 'No subscribers' })
						.where(eq(notificationQueue.id, item.id));
				}
				continue;
			}

			// Deduplicate by groupKey - only send the latest for each unique groupKey
			const latestByGroupKey = new Map<string, typeof items[0]>();
			for (const item of items) {
				const existing = latestByGroupKey.get(item.groupKey);
				if (!existing || item.createdAt > existing.createdAt) {
					latestByGroupKey.set(item.groupKey, item);
				}
			}

			// Mark duplicates as skipped (superseded by newer notification)
			const latestIds = new Set([...latestByGroupKey.values()].map(i => i.id));
			for (const item of items) {
				if (!latestIds.has(item.id)) {
					await db
						.update(notificationQueue)
						.set({ status: 'skipped', sentAt: new Date(), error: 'Superseded by newer notification' })
						.where(eq(notificationQueue.id, item.id));
				}
			}

			// Send notifications using batch API
			for (const item of latestByGroupKey.values()) {
				// Build batch of emails for all subscribers
				const emails: EmailMessage[] = [];
				
				for (const subscriber of subscribers) {
					const { subject, html } = generator(
						{ email: subscriber.email, firstName: subscriber.firstName },
						item.payload,
						ORIGIN
					);

					emails.push({
						from: FROM_ADDRESS,
						to: subscriber.email,
						subject,
						html
					});
				}

				// Send batch
				const { sent, failed } = await sendEmailBatch(emails);

				await db
					.update(notificationQueue)
					.set({ 
						status: failed === subscribers.length ? 'failed' : 'sent',
						sentAt: new Date(),
						error: failed > 0 ? `${failed}/${emails.length} send failures` : null
					})
					.where(eq(notificationQueue.id, item.id));
			}
		}
	} catch (err) {
		console.error('❌ Error processing queue:', err);
	} finally {
		isProcessing = false;
	}
}

// ============================================================================
// Main
// ============================================================================

console.log('📧 Notification Worker starting...');
console.log(`📂 Database: ${DATABASE_URL}`);
console.log(`🌐 Origin: ${ORIGIN}`);
console.log(`📮 Resend: ${RESEND_API_KEY ? 'configured' : 'MOCK MODE'}`);

// Graceful shutdown
process.on('SIGINT', () => {
	console.log('\n⏹️  Shutting down gracefully...');
	shouldExit = true;
});

process.on('SIGTERM', () => {
	console.log('\n⏹️  Received SIGTERM, shutting down...');
	shouldExit = true;
});

async function main(): Promise<void> {
	// Check if notification_queue table exists
	let tableReady = false;
	let retries = 0;
	const maxRetries = 30;

	while (!tableReady && retries < maxRetries) {
		try {
			await db.select().from(notificationQueue).limit(1);
			tableReady = true;
		} catch (err) {
			if (retries === 0) {
				console.log('⏳ Waiting for database migrations...');
			}
			retries++;
			await new Promise(resolve => setTimeout(resolve, 2000));
		}
	}

	if (!tableReady) {
		console.error('❌ notification_queue table not found. Run: npm run db:push');
		process.exit(1);
	}
	console.log('✅ Database ready');
	console.log('🔄 Starting notification polling loop...\n');

	// Main polling loop
	while (!shouldExit) {
		await processQueue();
		await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
	}

	console.log('👋 Worker shutdown complete');
	process.exit(0);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
