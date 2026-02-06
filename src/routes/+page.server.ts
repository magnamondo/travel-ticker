import { redirect } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ fetch, locals }) => {
	const response = await fetch('/api/milestones?offset=0&limit=10');
	const data = await response.json();
	
	return {
		milestones: data.milestones,
		hasMore: data.hasMore,
		user: locals.user ? { id: locals.user.id, email: locals.user.email, roles: locals.user.roles } : null
	};
};

export const actions: Actions = {
	logout: async (event) => {
		if (event.locals.session) {
			await auth.invalidateSession(event.locals.session.id);
			auth.deleteSessionTokenCookie(event);
		}
		throw redirect(303, '/');
	}
};
