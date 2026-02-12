import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { isAdmin } from '$lib/roles';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, '/login?redirectTo=' + encodeURIComponent(url.pathname));
	}
	if (!isAdmin(locals.user.roles)) {
		throw redirect(303, '/');
	}
};
