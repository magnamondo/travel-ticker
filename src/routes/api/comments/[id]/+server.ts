import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { comment } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { canComment, isAdmin } from '$lib/roles';

const EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function isWithinEditWindow(createdAt: Date): boolean {
	return Date.now() - createdAt.getTime() < EDIT_WINDOW_MS;
}

// PUT - Edit a comment (owner only, within 5 min)
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}

	if (!canComment(locals.user.roles)) {
		throw error(403, 'You do not have permission to edit comments');
	}

	const existingComment = await db
		.select()
		.from(comment)
		.where(eq(comment.id, params.id))
		.get();

	if (!existingComment) {
		throw error(404, 'Comment not found');
	}

	// Only owner can edit their own comment
	if (existingComment.userId !== locals.user.id) {
		throw error(403, 'You can only edit your own comments');
	}

	// Check 5-minute window
	if (!isWithinEditWindow(existingComment.createdAt)) {
		throw error(403, 'Comments can only be edited within 5 minutes of posting');
	}

	const body = await request.json();
	let content = body.content?.toString().trim();

	if (!content) {
		throw error(400, 'Comment content is required');
	}

	// Sanitize content
	content = content
		.replace(/<[^>]*>/g, '')
		.replace(/\n{3,}/g, '\n\n');

	await db
		.update(comment)
		.set({
			content,
			updatedAt: new Date()
		})
		.where(eq(comment.id, params.id));

	const updatedComment = await db
		.select()
		.from(comment)
		.where(eq(comment.id, params.id))
		.get();

	return json({
		success: true,
		comment: {
			id: updatedComment!.id,
			content: updatedComment!.content,
			updatedAt: updatedComment!.updatedAt?.toISOString()
		}
	});
};

// DELETE - Delete a comment (owner within 5 min, or admin anytime)
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}

	const existingComment = await db
		.select()
		.from(comment)
		.where(eq(comment.id, params.id))
		.get();

	if (!existingComment) {
		throw error(404, 'Comment not found');
	}

	const userIsAdmin = isAdmin(locals.user.roles);
	const isOwner = existingComment.userId === locals.user.id;

	if (userIsAdmin) {
		// Admins can delete any comment anytime
		await db.delete(comment).where(eq(comment.id, params.id));
		return json({ success: true });
	}

	if (!isOwner) {
		throw error(403, 'You can only delete your own comments');
	}

	if (!isWithinEditWindow(existingComment.createdAt)) {
		throw error(403, 'Comments can only be deleted within 5 minutes of posting');
	}

	await db.delete(comment).where(eq(comment.id, params.id));
	return json({ success: true });
};
