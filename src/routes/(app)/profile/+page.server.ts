import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import * as auth from '$lib/server/auth';
import { hashPassword, verifyPassword } from '$lib/server/password';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(303, '/login?redirectTo=/profile');
	}

	const [profile] = await db
		.select()
		.from(table.userProfile)
		.where(eq(table.userProfile.userId, event.locals.user.id));

	return {
		user: {
			id: event.locals.user.id,
			email: event.locals.user.email
		},
		profile: profile ?? null
	};
};

export const actions: Actions = {
	updateProfile: async (event) => {
		if (!event.locals.user) {
			throw redirect(303, '/login');
		}

		const formData = await event.request.formData();
		const title = formData.get('title') as string | null;
		const firstName = formData.get('firstName') as string | null;
		const lastName = formData.get('lastName') as string | null;
		const phoneNumber = formData.get('phoneNumber') as string | null;
		const dateOfBirth = formData.get('dateOfBirth') as string | null;

		// Validate fields
		if (firstName && firstName.length > 100) {
			return fail(400, { message: 'First name is too long' });
		}
		if (lastName && lastName.length > 100) {
			return fail(400, { message: 'Last name is too long' });
		}
		if (phoneNumber && phoneNumber.length > 30) {
			return fail(400, { message: 'Phone number is too long' });
		}

		// Sanitize: strip HTML tags
		const stripHtml = (str: string | null) => str?.replace(/<[^>]*>/g, '').trim() || null;

		const profileData = {
			title: stripHtml(title),
			firstName: stripHtml(firstName),
			lastName: stripHtml(lastName),
			phoneNumber: stripHtml(phoneNumber),
			dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null
		};

		// Check if profile exists
		const [existingProfile] = await db
			.select()
			.from(table.userProfile)
			.where(eq(table.userProfile.userId, event.locals.user.id));

		if (existingProfile) {
			await db
				.update(table.userProfile)
				.set(profileData)
				.where(eq(table.userProfile.userId, event.locals.user.id));
		} else {
			await db.insert(table.userProfile).values({
				id: crypto.randomUUID(),
				userId: event.locals.user.id,
				...profileData
			});
		}

		return { success: true };
	},

	changePassword: async (event) => {
		if (!event.locals.user) {
			throw redirect(303, '/login');
		}

		const formData = await event.request.formData();
		const currentPassword = formData.get('currentPassword') as string;
		const newPassword = formData.get('newPassword') as string;
		const confirmPassword = formData.get('confirmPassword') as string;

		// Validate inputs
		if (!currentPassword || !newPassword || !confirmPassword) {
			return fail(400, { passwordError: 'All password fields are required' });
		}

		if (newPassword.length < 6) {
			return fail(400, { passwordError: 'New password must be at least 6 characters' });
		}

		if (newPassword.length > 255) {
			return fail(400, { passwordError: 'New password is too long' });
		}

		if (newPassword !== confirmPassword) {
			return fail(400, { passwordError: 'New passwords do not match' });
		}

		// Get current user's password hash
		const [user] = await db
			.select()
			.from(table.user)
			.where(eq(table.user.id, event.locals.user.id));

		if (!user) {
			return fail(400, { passwordError: 'User not found' });
		}

		// Verify current password
		const validPassword = await verifyPassword(currentPassword, user.passwordHash);
		if (!validPassword) {
			return fail(400, { passwordError: 'Current password is incorrect' });
		}

		// Hash and update the new password
		const newPasswordHash = await hashPassword(newPassword);
		await db
			.update(table.user)
			.set({ passwordHash: newPasswordHash })
			.where(eq(table.user.id, event.locals.user.id));

		return { passwordSuccess: true };
	},

	logout: async (event) => {
		if (event.locals.session) {
			await auth.invalidateSession(event.locals.session.id);
			auth.deleteSessionTokenCookie(event);
		}
		throw redirect(303, '/');
	}
};
