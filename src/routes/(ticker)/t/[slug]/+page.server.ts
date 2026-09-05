import { error } from '@sveltejs/kit';
import { getTickerBySlug, canViewUnpublishedTickers } from '$lib/server/tickers';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, url, params, locals }) => {
	const ticker = await getTickerBySlug(params.slug);
	if (!ticker) {
		throw error(404, 'Ticker not found');
	}
	if (!ticker.published && !canViewUnpublishedTickers(locals.user?.roles)) {
		throw error(404, 'Ticker not found');
	}

	const response = await fetch(
		`/api/milestones?ticker=${encodeURIComponent(ticker.slug)}&offset=0&limit=3`
	);
	if (!response.ok) {
		throw error(500, 'Failed to load entries');
	}
	const data = await response.json();

	return {
		origin: url.origin,
		ticker: {
			id: ticker.id,
			slug: ticker.slug,
			name: ticker.name,
			tagline: ticker.tagline,
			description: ticker.description,
			originLabel: ticker.originLabel,
			destinationLabel: ticker.destinationLabel,
			coverImage: ticker.coverImage,
			published: ticker.published
		},
		milestones: data.milestones,
		hasMore: data.hasMore
	};
};
