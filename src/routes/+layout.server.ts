import type { LayoutServerLoad } from './$types';
import { isAdmin, canComment, canReact } from '$lib/roles';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user ? {
			id: locals.user.id,
			email: locals.user.email,
			roles: locals.user.roles,
			isAdmin: isAdmin(locals.user.roles),
			canComment: canComment(locals.user.roles),
			canReact: canReact(locals.user.roles)
		} : null
	};
};
