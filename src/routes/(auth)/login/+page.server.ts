import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as auth from '$lib/server/auth';
import * as table from '$lib/server/db/schema';
import { verifyPassword } from '$lib/server/password';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		return redirect(302, '/');
	}
	return {};
};

export const actions: Actions = {
	login: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email');
		const password = formData.get('password');

		if (!validateEmail(email)) {
			return fail(400, { message: 'Invalid email' });
		}
		if (!validatePassword(password)) {
			return fail(400, { message: 'Invalid password (min 6, max 255 characters)' });
		}

		const results = await db
			.select()
			.from(table.user)
			.where(eq(table.user.email, email));

		const existingUser = results.at(0);
		if (!existingUser) {
			return fail(400, { message: 'Incorrect email or password' });
		}

		const validPassword = await verifyPassword(password, existingUser.passwordHash);
		if (!validPassword) {
			return fail(400, { message: 'Incorrect email or password' });
		}

		if (!existingUser.emailVerified) {
			return fail(400, { message: 'Please verify your email address before logging in' });
		}

		const sessionToken = auth.generateSessionToken();
		const session = await auth.createSession(sessionToken, existingUser.id);
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);

		const redirectTo = formData.get('redirectTo') as string | null;
		if (redirectTo && redirectTo.startsWith('/')) {
			return redirect(302, redirectTo);
		}

		return redirect(302, '/');
	}
};


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
