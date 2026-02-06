import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sendResetPasswordEmail } from '$lib/server/emails/reset-password';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email');

		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return fail(400, { 
				message: 'Invalid email', 
				success: false
			});
		}

		const results = await db.select().from(table.user).where(eq(table.user.email, email));
		const user = results.at(0);

		if (!user) {
			// Don't reveal if user exists
			return { message: 'If an account exists with that email, we have sent a reset link.', success: true };
		}

		const token = generateToken();
		const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 2); // 2 hours

		await db.update(table.user)
			.set({ 
				resetPasswordToken: token,
				resetPasswordExpires: expiresAt
			})
			.where(eq(table.user.id, user.id));

		// Send reset password email
		const origin = event.url.origin;
		await sendResetPasswordEmail({ email, resetToken: token, userId: user.id }, origin);

		return { message: 'If an account exists with that email, we have sent a reset link.', success: true };
	}
};

function generateToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	return encodeBase32LowerCase(bytes);
}
