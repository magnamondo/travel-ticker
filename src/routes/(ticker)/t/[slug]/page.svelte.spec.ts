import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

const ticker = {
	id: 'tkr_test',
	slug: 'test-trip',
	name: 'Test Trip',
	tagline: null,
	description: null,
	originLabel: 'Toulouse',
	destinationLabel: 'Lomé',
	coverImage: null,
	published: true
};

describe('/t/[slug]/+page.svelte', () => {
	it('renders the ticker route in the header', async () => {
		render(Page, {
			data: { origin: 'http://localhost', ticker, milestones: [], hasMore: false, user: null }
		});

		await expect.element(page.getByText('Toulouse')).toBeInTheDocument();
		await expect.element(page.getByText('Lomé')).toBeInTheDocument();
	});
});
