import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '$lib/notification-types';
import type { PageServerLoad } from './$types';

/**
 * Attempts to extract first and last name from an email address.
 * Handles formats like: john.doe@, john_doe@, johndoe@, john-doe@
 */
function guessNameFromEmail(email: string): { firstName: string | null; lastName: string | null } {
	const localPart = email.split('@')[0];
	if (!localPart) return { firstName: null, lastName: null };

	// Split on common separators: . _ -
	const parts = localPart.split(/[._-]+/).filter(Boolean);
	
	const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

	if (parts.length >= 2) {
		// e.g., john.doe or john_smith
		return {
			firstName: capitalize(parts[0]),
			lastName: capitalize(parts[parts.length - 1])
		};
	} else if (parts.length === 1) {
		// Single word - use as first name
		return {
			firstName: capitalize(parts[0]),
			lastName: null
		};
	}

	return { firstName: null, lastName: null };
}

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

	// Create user profile with default notification preferences if it doesn't exist
	const existingProfile = await db.select().from(table.userProfile)
		.where(eq(table.userProfile.userId, user.id));
	
	if (existingProfile.length === 0) {
		const { firstName, lastName } = guessNameFromEmail(user.email);
		await db.insert(table.userProfile).values({
			id: crypto.randomUUID(),
			userId: user.id,
			firstName,
			lastName,
			notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES
		});
	}

	return { success: true, message: 'Email has been successfully verified!' };
};
