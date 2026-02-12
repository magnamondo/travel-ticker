import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { userGroup, user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { isAdmin } from '$lib/roles';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}
	if (!isAdmin(locals.user.roles)) {
		throw error(403, 'Only administrators can view group members');
	}

	const { groupId } = params;
	
	const members = await db
		.select({
			id: user.id,
			email: user.email,
			role: userGroup.role
		})
		.from(userGroup)
		.innerJoin(user, eq(userGroup.userId, user.id))
		.where(eq(userGroup.groupId, groupId));
	
	return json(members);
};
