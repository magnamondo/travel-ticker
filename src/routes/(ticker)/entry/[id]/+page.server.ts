import { error, redirect } from '@sveltejs/kit';
import { getTickerSlugForMilestone } from '$lib/server/tickers';
import type { PageServerLoad } from './$types';

/**
 * Legacy single-ticker URL. Entries now live at /t/<slug>/entry/<id>, but
 * links in already-sent emails, bookmarks and the admin tables still point
 * here, so resolve the entry's ticker and forward to the canonical URL.
 */
export const load: PageServerLoad = async ({ params }) => {
	const slug = await getTickerSlugForMilestone(params.id);
	if (!slug) {
		throw error(404, 'Entry not found');
	}
	throw redirect(301, `/t/${slug}/entry/${params.id}`);
};
