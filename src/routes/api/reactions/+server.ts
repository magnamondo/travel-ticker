import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { reaction, comment } from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { canReact, isAdmin } from '$lib/roles';
import { isValidEmoji } from '$lib/emojis';

function generateId(): string {
	return crypto.randomUUID();
}

async function getGroupedReactions(targetType: 'milestone' | 'comment', targetId: string) {
	const whereClause = targetType === 'milestone'
		? eq(reaction.milestoneId, targetId)
		: eq(reaction.commentId, targetId);

	const reactions = await db
		.select({
			emoji: reaction.emoji,
			userId: reaction.userId,
		})
		.from(reaction)
		.where(whereClause);

	// Group reactions by emoji and collect userIds
	const grouped = reactions.reduce((acc, r) => {
		if (!acc[r.emoji]) {
			acc[r.emoji] = { count: 0, userIds: [] as string[] };
		}
		acc[r.emoji].count++;
		acc[r.emoji].userIds.push(r.userId);
		return acc;
	}, {} as Record<string, { count: number; userIds: string[] }>);

	return grouped;
}

export const GET: RequestHandler = async ({ url }) => {
	const targetType = url.searchParams.get('type') as 'milestone' | 'comment' | null;
	const targetId = url.searchParams.get('id');

	if (!targetType || !targetId) {
		throw error(400, 'Missing type or id parameter');
	}

	const grouped = await getGroupedReactions(targetType, targetId);

	return json({ reactions: grouped });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Must be logged in to react');
	}

	if (!canReact(locals.user.roles)) {
		throw error(403, 'You do not have permission to add reactions');
	}

	const { targetType, targetId, emoji } = await request.json();

	if (!targetType || !targetId || !emoji) {
		throw error(400, 'Missing required fields');
	}

	if (!isValidEmoji(emoji)) {
		throw error(400, 'Invalid emoji');
	}

	// Check if user already reacted with this emoji
	const whereClause = targetType === 'milestone'
		? and(
			eq(reaction.milestoneId, targetId),
			eq(reaction.userId, locals.user.id),
			eq(reaction.emoji, emoji)
		)
		: and(
			eq(reaction.commentId, targetId),
			eq(reaction.userId, locals.user.id),
			eq(reaction.emoji, emoji)
		);

	const existing = await db
		.select({ id: reaction.id })
		.from(reaction)
		.where(whereClause)
		.limit(1);

	if (existing.length > 0) {
		// Remove the reaction (toggle off)
		await db.delete(reaction).where(eq(reaction.id, existing[0].id));
	} else {
		// Add the reaction
		const newReaction = {
			id: generateId(),
			userId: locals.user.id,
			emoji,
			createdAt: new Date(),
			milestoneId: targetType === 'milestone' ? targetId : null,
			commentId: targetType === 'comment' ? targetId : null,
		};
		await db.insert(reaction).values(newReaction);
	}

	// Return updated grouped reactions
	const grouped = await getGroupedReactions(targetType, targetId);

	return json({ reactions: grouped });
};

// Admin-only: Delete any reaction by ID
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, 'Must be logged in');
	}

	if (!isAdmin(locals.user.roles)) {
		throw error(403, 'Admin access required');
	}

	const reactionId = url.searchParams.get('id');
	if (!reactionId) {
		throw error(400, 'Missing reaction id');
	}

	// Verify reaction exists
	const existing = await db
		.select({ id: reaction.id })
		.from(reaction)
		.where(eq(reaction.id, reactionId))
		.limit(1);

	if (existing.length === 0) {
		throw error(404, 'Reaction not found');
	}

	await db.delete(reaction).where(eq(reaction.id, reactionId));

	return json({ success: true });
};
