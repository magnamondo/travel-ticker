import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { comment } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { isAdmin } from '$lib/roles';

// POST - Toggle hide/unhide a comment (admin only)
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}

	if (!isAdmin(locals.user.roles)) {
		throw error(403, 'Only administrators can moderate comments');
	}

	const existingComment = await db
		.select()
		.from(comment)
		.where(eq(comment.id, params.id))
		.get();

	if (!existingComment) {
		throw error(404, 'Comment not found');
	}

	const body = await request.json();
	const hide = body.hide ?? !existingComment.isHidden;

	await db
		.update(comment)
		.set({ isHidden: hide })
		.where(eq(comment.id, params.id));

	return json({
		success: true,
		isHidden: hide
	});
};
