import { encodeBase32LowerCase } from '@oslojs/encoding';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/password';
import { sendVerifyEmail } from '$lib/server/emails/verify-email';
import { getDefaultRole } from '$lib/roles';
import { env } from '$env/dynamic/private';
import type { PageServerLoad, Actions } from './$types';

/**
 * Determine roles for a new user.
 * If ADMIN_EMAIL env var is set and matches, grant admin role.
 */
function getRolesForEmail(email: string): string[] {
	const adminEmail = env.ADMIN_EMAIL?.toLowerCase();
	if (adminEmail && email.toLowerCase() === adminEmail) {
		return ['admin'];
	}
	return [getDefaultRole()];
}

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		return redirect(302, '/');
	}
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email');
		const password = formData.get('password');

		if (!validateEmail(email)) {
			return fail(400, { message: 'Invalid email' });
		}
		if (!validatePassword(password)) {
			return fail(400, { message: 'Invalid password (min 6, max 255 characters)' });
		}

		try {
			const results = await db
				.select()
				.from(table.user)
				.where(eq(table.user.email, email));

			if (results.length > 0) {
				return fail(400, { message: 'Email already registered' });
			}

			const userId = generateUserId();
			const verificationToken = generateUserId();
			const passwordHash = await hashPassword(password);
		
			await db.insert(table.user).values({ 
				id: userId, 
				email, 
				passwordHash,
				roles: getRolesForEmail(email),
				verificationToken,
				emailVerified: false,
				createdAt: new Date()
			});
			
			// Send verification email
			const origin = event.url.origin;
			await sendVerifyEmail({ email, verificationToken, userId }, origin);

		} catch (e) {
			console.error('Registration failed', e);
			return fail(500, { message: 'An error has occurred' });
		}
		return redirect(302, '/login?verificationSent=true');
	}
};

function generateUserId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	const id = encodeBase32LowerCase(bytes);
	return id;
}

function validateEmail(email: unknown): email is string {
	return (
		typeof email === 'string' &&
		email.length >= 3 &&
		email.length <= 255 &&
		/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)
	);
}

function validatePassword(password: unknown): password is string {
	return (
		typeof password === 'string' &&
		password.length >= 6 &&
		password.length <= 255
	);
}
