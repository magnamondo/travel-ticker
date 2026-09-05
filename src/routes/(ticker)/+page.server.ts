import { redirect } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import { listTickersForUser } from '$lib/server/tickers';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tickers = await listTickersForUser(locals.user?.id, locals.user?.roles);

	return {
		origin: url.origin,
		tickers
	};
};

export const actions: Actions = {
	// UserMenu posts here from every page, so this action has to stay at `/`.
	logout: async (event) => {
		if (event.locals.session) {
			await auth.invalidateSession(event.locals.session.id);
			auth.deleteSessionTokenCookie(event);
		}
		throw redirect(303, '/');
	}
};
