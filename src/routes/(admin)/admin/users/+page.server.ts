import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { user, userProfile, session } from '$lib/server/db/schema';
import { desc, eq, count } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { hashPassword } from '$lib/server/password';
import { randomUUID } from 'crypto';
import { ROLES, type Role } from '$lib/roles';

export const load: PageServerLoad = async () => {
	const users = await db
		.select({
			id: user.id,
			email: user.email,
			roles: user.roles,
			emailVerified: user.emailVerified,
			createdAt: user.createdAt,
			profile: {
				title: userProfile.title,
				firstName: userProfile.firstName,
				lastName: userProfile.lastName,
				phoneNumber: userProfile.phoneNumber
			}
		})
		.from(user)
		.leftJoin(userProfile, eq(user.id, userProfile.userId))
		.orderBy(desc(user.createdAt));

	// Calculate stats
	const stats = {
		total: users.length,
		verified: users.filter(u => u.emailVerified).length,
		unverified: users.filter(u => !u.emailVerified).length,
		admins: users.filter(u => u.roles?.includes('admin')).length,
		writers: users.filter(u => u.roles?.includes('writer')).length,
		reactors: users.filter(u => u.roles?.includes('reactor')).length,
		readers: users.filter(u => !u.roles || u.roles.length === 0 || u.roles.includes('reader')).length
	};

	return {
		users,
		stats
	};
};

export const actions: Actions = {
	create: async ({ request }) => {
		const formData = await request.formData();
		const email = (formData.get('email') as string)?.trim().toLowerCase();
		const password = formData.get('password') as string;
		const firstName = formData.get('firstName') as string;
		const lastName = formData.get('lastName') as string;
		const role = formData.get('role') as Role;
		const emailVerified = formData.get('emailVerified') === 'on';

		if (!email || !password) {
			return fail(400, { error: 'Email and password are required' });
		}

		if (password.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters' });
		}

		if (!role || !ROLES.includes(role)) {
			return fail(400, { error: 'Invalid role selected' });
		}

		// Check if user already exists
		const existing = await db.select().from(user).where(eq(user.email, email));
		if (existing.length > 0) {
			return fail(400, { error: 'A user with this email already exists' });
		}

		const userId = randomUUID();
		const passwordHash = await hashPassword(password);
		const roles = [role];

		await db.insert(user).values({
			id: userId,
			email,
			passwordHash,
			roles,
			emailVerified,
			createdAt: new Date()
		});

		if (firstName || lastName) {
			await db.insert(userProfile).values({
				id: randomUUID(),
				userId,
				firstName: firstName || null,
				lastName: lastName || null
			});
		}

		return { success: true, message: 'User created successfully' };
	},

	update: async ({ request }) => {
		const formData = await request.formData();
		const userId = formData.get('userId') as string;
		const email = (formData.get('email') as string)?.trim().toLowerCase();
		const firstName = formData.get('firstName') as string;
		const lastName = formData.get('lastName') as string;
		const role = formData.get('role') as Role;
		const emailVerified = formData.get('emailVerified') === 'on';

		if (!userId || !email) {
			return fail(400, { error: 'User ID and email are required' });
		}

		if (!role || !ROLES.includes(role)) {
			return fail(400, { error: 'Invalid role selected' });
		}

		// Check for duplicate email
		const existing = await db.select().from(user).where(eq(user.email, email));
		if (existing.length > 0 && existing[0].id !== userId) {
			return fail(400, { error: 'Another user with this email already exists' });
		}

		const roles = [role];

		await db.update(user)
			.set({ email, roles, emailVerified })
			.where(eq(user.id, userId));

		// Update or create profile
		const existingProfile = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
		if (existingProfile.length > 0) {
			await db.update(userProfile)
				.set({ firstName: firstName || null, lastName: lastName || null })
				.where(eq(userProfile.userId, userId));
		} else if (firstName || lastName) {
			await db.insert(userProfile).values({
				id: randomUUID(),
				userId,
				firstName: firstName || null,
				lastName: lastName || null
			});
		}

		return { success: true, message: 'User updated successfully' };
	},

	resetPassword: async ({ request }) => {
		const formData = await request.formData();
		const userId = formData.get('userId') as string;
		const newPassword = formData.get('newPassword') as string;

		if (!userId || !newPassword) {
			return fail(400, { error: 'User ID and new password are required' });
		}

		if (newPassword.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters' });
		}

		const passwordHash = await hashPassword(newPassword);

		await db.update(user)
			.set({ passwordHash, resetPasswordToken: null, resetPasswordExpires: null })
			.where(eq(user.id, userId));

		return { success: true, message: 'Password reset successfully' };
	},

	delete: async ({ request }) => {
		const formData = await request.formData();
		const userId = formData.get('userId') as string;

		if (!userId) {
			return fail(400, { error: 'User ID required' });
		}

		// Delete user sessions first
		await db.delete(session).where(eq(session.userId, userId));

		// Delete user (profile will cascade)
		await db.delete(user).where(eq(user.id, userId));

		return { success: true, message: 'User deleted successfully' };
	},

	verifyEmail: async ({ request }) => {
		const formData = await request.formData();
		const userId = formData.get('userId') as string;

		if (!userId) {
			return fail(400, { error: 'User ID required' });
		}

		await db.update(user)
			.set({ emailVerified: true, verificationToken: null })
			.where(eq(user.id, userId));

		return { success: true, message: 'Email verified' };
	},

	revokeAllSessions: async ({ request }) => {
		const formData = await request.formData();
		const userId = formData.get('userId') as string;

		if (!userId) {
			return fail(400, { error: 'User ID required' });
		}

		await db.delete(session).where(eq(session.userId, userId));

		return { success: true, message: 'All sessions revoked' };
	}
};
