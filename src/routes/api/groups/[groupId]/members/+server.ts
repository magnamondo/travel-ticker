import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { userGroup, user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
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
