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
import { eq, and, lte, inArray, sql } from 'drizzle-orm';
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
	comment_replies?: boolean;
	comment_reactions?: boolean;
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
	status: text('status', { enum: ['pending', 'cancelled', 'sent', 'failed'] }).notNull().default('pending'),
	sendAfter: integer('send_after', { mode: 'timestamp' }).notNull(),
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
	title: text('title').notNull()
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

type EmailGenerator<T = unknown> = (
	recipient: Recipient,
	data: T,
	origin: string
) => { subject: string; html: string };

// Registry of email generators by notification type
const emailGenerators: Map<string, EmailGenerator> = new Map();

// New Milestone notification
interface NewMilestoneData {
	milestoneId: string;
	milestoneTitle: string;
	segmentName: string;
}

emailGenerators.set('new_milestones', ((recipient: Recipient, data: NewMilestoneData, origin: string) => {
	const milestoneUrl = `${origin}/entry/${data.milestoneId}`;
	const greeting = recipient.firstName ? `Hi ${recipient.firstName},` : 'Hi,';

	return {
		subject: `New milestone: ${data.milestoneTitle}`,
		html: `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: system-ui, -apple-system, sans-serif;">
	<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
		<tr>
			<td align="center" style="padding: 40px 20px;">
				<div style="max-width: 500px; margin: 0 auto; text-align: left;">
					<p style="color: #333; font-size: 16px; line-height: 1.6;">${greeting}</p>
					
					<p style="color: #333; font-size: 16px; line-height: 1.6;">
						A new milestone has been posted in <strong>${data.segmentName}</strong>:
					</p>
					
					<div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
						<h2 style="margin: 0 0 10px; color: #000;">${data.milestoneTitle}</h2>
					</div>
					
					<a href="${milestoneUrl}" style="background-color: #000; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; display: inline-block; font-weight: 600;">
						View Milestone
					</a>
					
					<p style="color: #666; font-size: 13px; margin-top: 30px;">
						You're receiving this because you subscribed to new milestone notifications.
					</p>
				</div>
			</td>
		</tr>
	</table>
</body>
</html>`
	};
}) as EmailGenerator);

// Comment Reply notification
interface CommentReplyData {
	milestoneId: string;
	milestoneTitle: string;
	commenterName: string;
}

emailGenerators.set('comment_replies', ((recipient: Recipient, data: CommentReplyData, origin: string) => {
	const milestoneUrl = `${origin}/entry/${data.milestoneId}`;
	const greeting = recipient.firstName ? `Hi ${recipient.firstName},` : 'Hi,';

	return {
		subject: `New comment on: ${data.milestoneTitle}`,
		html: `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: system-ui, -apple-system, sans-serif;">
	<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
		<tr>
			<td align="center" style="padding: 40px 20px;">
				<div style="max-width: 500px; margin: 0 auto; text-align: left;">
					<p style="color: #333; font-size: 16px; line-height: 1.6;">${greeting}</p>
					
					<p style="color: #333; font-size: 16px; line-height: 1.6;">
						<strong>${data.commenterName}</strong> commented on a milestone you're following:
					</p>
					
					<div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
						<p style="margin: 0; color: #000;">${data.milestoneTitle}</p>
					</div>
					
					<a href="${milestoneUrl}" style="background-color: #000; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; display: inline-block; font-weight: 600;">
						View Discussion
					</a>
					
					<p style="color: #666; font-size: 13px; margin-top: 30px;">
						You're receiving this because you commented on this milestone.
					</p>
				</div>
			</td>
		</tr>
	</table>
</body>
</html>`
	};
}) as EmailGenerator);

// Comment Reaction notification
interface CommentReactionData {
	milestoneId: string;
	milestoneTitle: string;
	reactorName: string;
	emoji: string;
}

emailGenerators.set('comment_reactions', ((recipient: Recipient, data: CommentReactionData, origin: string) => {
	const milestoneUrl = `${origin}/entry/${data.milestoneId}`;
	const greeting = recipient.firstName ? `Hi ${recipient.firstName},` : 'Hi,';

	return {
		subject: `${data.reactorName} reacted to your comment`,
		html: `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: system-ui, -apple-system, sans-serif;">
	<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
		<tr>
			<td align="center" style="padding: 40px 20px;">
				<div style="max-width: 500px; margin: 0 auto; text-align: left;">
					<p style="color: #333; font-size: 16px; line-height: 1.6;">${greeting}</p>
					
					<p style="color: #333; font-size: 16px; line-height: 1.6;">
						<strong>${data.reactorName}</strong> reacted ${data.emoji} to your comment on:
					</p>
					
					<div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
						<p style="margin: 0; color: #000;">${data.milestoneTitle}</p>
					</div>
					
					<a href="${milestoneUrl}" style="background-color: #000; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; display: inline-block; font-weight: 600;">
						View Comment
					</a>
					
					<p style="color: #666; font-size: 13px; margin-top: 30px;">
						You're receiving this because you subscribed to comment reaction notifications.
					</p>
				</div>
			</td>
		</tr>
	</table>
</body>
</html>`
	};
}) as EmailGenerator);

// ============================================================================
// Email Sending
// ============================================================================

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
	if (resend) {
		try {
			await resend.emails.send({
				from: 'Magnamondo <system@magnamondo.com>',
				to,
				subject,
				html
			});
			return true;
		} catch (err) {
			console.error(`  ❌ Failed to send to ${to}:`, err);
			return false;
		}
	} else {
		// Mock mode for development
		console.log(`  📧 [MOCK] To: ${to}`);
		console.log(`     Subject: ${subject}`);
		return true;
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

		console.log(`📬 Processing ${pendingItems.length} notification(s)...`);

		// Group by typeId for efficient subscriber lookup
		const byType = new Map<string, typeof pendingItems>();
		for (const item of pendingItems) {
			const existing = byType.get(item.typeId) ?? [];
			existing.push(item);
			byType.set(item.typeId, existing);
		}

		for (const [typeId, items] of byType) {
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
				console.log(`  ℹ️  No subscribers for type: ${typeId}`);
				// Mark as sent anyway (no one to notify)
				for (const item of items) {
					await db
						.update(notificationQueue)
						.set({ status: 'sent', sentAt: new Date() })
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

			// Mark duplicates as sent (skipped)
			const latestIds = new Set([...latestByGroupKey.values()].map(i => i.id));
			for (const item of items) {
				if (!latestIds.has(item.id)) {
					await db
						.update(notificationQueue)
						.set({ status: 'sent', sentAt: new Date() })
						.where(eq(notificationQueue.id, item.id));
				}
			}

			// Send notifications
			for (const item of latestByGroupKey.values()) {
				let sentCount = 0;
				let failCount = 0;

				for (const subscriber of subscribers) {
					const { subject, html } = generator(
						{ email: subscriber.email, firstName: subscriber.firstName },
						item.payload,
						ORIGIN
					);

					const success = await sendEmail(subscriber.email, subject, html);
					if (success) {
						sentCount++;
					} else {
						failCount++;
					}
				}

				console.log(`  ✅ ${item.groupKey}: sent ${sentCount}, failed ${failCount}`);

				await db
					.update(notificationQueue)
					.set({ 
						status: failCount === subscribers.length ? 'failed' : 'sent',
						sentAt: new Date(),
						error: failCount > 0 ? `${failCount} send failures` : null
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
