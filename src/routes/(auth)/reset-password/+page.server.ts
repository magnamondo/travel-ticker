import { fail, redirect } from '@sveltejs/kit';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/password';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async (event) => {
	const token = event.url.searchParams.get('token');
	if (!token) {
		throw redirect(302, '/login');
	}
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const password = formData.get('password');
		const token = formData.get('token');

		if (!password || typeof password !== 'string' || password.length < 6) {
			return fail(400, { message: 'Password must be at least 6 characters', success: false });
		}
		if (!token || typeof token !== 'string') {
			return fail(400, { message: 'Invalid token', success: false });
		}

		// Find user with this token and not expired
		const results = await db.select().from(table.user)
			.where(and(
				eq(table.user.resetPasswordToken, token),
				gt(table.user.resetPasswordExpires, new Date())
			));
		const user = results.at(0);

		if (!user) {
			return fail(400, { message: 'Invalid or expired password reset link.', success: false });
		}

		const passwordHash = await hashPassword(password);

		await db.update(table.user)
			.set({ 
				passwordHash,
				resetPasswordToken: null,
				resetPasswordExpires: null
			})
			.where(eq(table.user.id, user.id));

		return { message: 'Password has been reset successfully.', success: true };
	}
};
