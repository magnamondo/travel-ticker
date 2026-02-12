import { redirect } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ fetch, url }) => {
	const response = await fetch('/api/milestones?offset=0&limit=3');
	const data = await response.json();

	return {
		origin: url.origin,
		milestones: data.milestones,
		hasMore: data.hasMore
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
