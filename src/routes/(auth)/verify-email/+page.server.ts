import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const token = event.url.searchParams.get('token');
	
	if (!token) {
		return { success: false, message: 'Missing verification token.' };
	}

	const results = await db.select().from(table.user)
		.where(eq(table.user.verificationToken, token));
	
	const user = results.at(0);

	if (!user) {
		return { success: false, message: 'Invalid verification token.' };
	}

	await db.update(table.user)
		.set({ 
			emailVerified: true,
			verificationToken: null
		})
		.where(eq(table.user.id, user.id));

	return { success: true, message: 'Email has been successfully verified!' };
};
