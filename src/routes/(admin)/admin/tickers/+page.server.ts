import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ticker, segment } from '$lib/server/db/schema';
import {
	generateUniqueSlug,
	getAdminTickerCounts,
	getNextTickerSortOrder,
	slugify,
	validateSlug
} from '$lib/server/tickers';

export const load: PageServerLoad = async () => {
	const tickers = await db
		.select()
		.from(ticker)
		.orderBy(asc(ticker.sortOrder), asc(ticker.createdAt));
	const counts = await getAdminTickerCounts();

	// Uploaded images double as cover art
	const uploadsDir = join(process.cwd(), process.env.DATA_DIR || 'data', 'uploads');
	let availableImages: string[] = [];
	try {
		const files = await readdir(uploadsDir);
		availableImages = files
			.filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
			.map((f) => `/api/uploads/${f}`);
	} catch {
		// uploads directory may not exist yet
	}

	return {
		tickers: tickers.map((t) => ({
			...t,
			segmentCount: counts.get(t.id)?.segmentCount ?? 0,
			entryCount: counts.get(t.id)?.entryCount ?? 0
		})),
		availableImages
	};
};

function readTickerForm(formData: FormData) {
	const str = (key: string) => {
		const value = formData.get(key);
		if (typeof value !== 'string') return null;
		const trimmed = value.trim();
		return trimmed === '' ? null : trimmed;
	};

	return {
		name: str('name'),
		slug: str('slug'),
		tagline: str('tagline'),
		description: str('description'),
		originLabel: str('originLabel'),
		destinationLabel: str('destinationLabel'),
		coverImage: str('coverImage'),
		published: formData.get('published') === 'on' || formData.get('published') === 'true'
	};
}

export const actions: Actions = {
	addTicker: async ({ request }) => {
		const formData = await request.formData();
		const input = readTickerForm(formData);

		if (!input.name) {
			return fail(400, { error: 'Name is required' });
		}

		// An explicit slug is validated as typed; a blank one is derived and
		// de-duplicated from the name.
		let slug: string;
		if (input.slug) {
			const normalized = slugify(input.slug);
			const slugError = validateSlug(normalized);
			if (slugError) return fail(400, { error: slugError });

			const [existing] = await db
				.select({ id: ticker.id })
				.from(ticker)
				.where(eq(ticker.slug, normalized))
				.limit(1);
			if (existing) return fail(400, { error: `Slug "${normalized}" is already in use` });
			slug = normalized;
		} else {
			slug = await generateUniqueSlug(input.name);
		}

		await db.insert(ticker).values({
			id: randomUUID(),
			slug,
			name: input.name,
			tagline: input.tagline,
			description: input.description,
			originLabel: input.originLabel,
			destinationLabel: input.destinationLabel,
			coverImage: input.coverImage,
			published: input.published,
			sortOrder: await getNextTickerSortOrder(),
			createdAt: new Date()
		});

		return { success: true, message: `Ticker created at /t/${slug}` };
	},

	updateTicker: async ({ request }) => {
		const formData = await request.formData();
		const tickerId = formData.get('tickerId');
		if (typeof tickerId !== 'string' || !tickerId) {
			return fail(400, { error: 'Missing ticker' });
		}

		const input = readTickerForm(formData);
		if (!input.name) {
			return fail(400, { error: 'Name is required' });
		}

		const [existing] = await db.select().from(ticker).where(eq(ticker.id, tickerId)).limit(1);
		if (!existing) {
			return fail(404, { error: 'Ticker not found' });
		}

		let slug = existing.slug;
		if (input.slug && input.slug !== existing.slug) {
			const normalized = slugify(input.slug);
			const slugError = validateSlug(normalized);
			if (slugError) return fail(400, { error: slugError });

			const [clash] = await db
				.select({ id: ticker.id })
				.from(ticker)
				.where(eq(ticker.slug, normalized))
				.limit(1);
			if (clash && clash.id !== tickerId) {
				return fail(400, { error: `Slug "${normalized}" is already in use` });
			}
			slug = normalized;
		}

		await db
			.update(ticker)
			.set({
				slug,
				name: input.name,
				tagline: input.tagline,
				description: input.description,
				originLabel: input.originLabel,
				destinationLabel: input.destinationLabel,
				coverImage: input.coverImage,
				published: input.published
			})
			.where(eq(ticker.id, tickerId));

		const renamed = slug !== existing.slug;
		return {
			success: true,
			message: renamed
				? `Ticker updated. Its URL is now /t/${slug} - old links to /t/${existing.slug} will 404.`
				: 'Ticker updated!'
		};
	},

	togglePublished: async ({ request }) => {
		const formData = await request.formData();
		const tickerId = formData.get('tickerId');
		if (typeof tickerId !== 'string' || !tickerId) {
			return fail(400, { error: 'Missing ticker' });
		}

		const [existing] = await db
			.select({ published: ticker.published, name: ticker.name })
			.from(ticker)
			.where(eq(ticker.id, tickerId))
			.limit(1);
		if (!existing) return fail(404, { error: 'Ticker not found' });

		await db.update(ticker).set({ published: !existing.published }).where(eq(ticker.id, tickerId));

		return {
			success: true,
			message: `"${existing.name}" is now ${existing.published ? 'a draft' : 'published'}`
		};
	},

	deleteTicker: async ({ request }) => {
		const formData = await request.formData();
		const tickerId = formData.get('tickerId');
		if (typeof tickerId !== 'string' || !tickerId) {
			return fail(400, { error: 'Missing ticker' });
		}

		// Deleting would cascade into segments (and their entries and media
		// files); require the ticker to be emptied first so nothing is lost
		// silently and no upload files are orphaned on disk.
		const segments = await db
			.select({ id: segment.id })
			.from(segment)
			.where(eq(segment.tickerId, tickerId));

		if (segments.length > 0) {
			return fail(400, {
				error: `Cannot delete a ticker that still has ${segments.length} segment(s). Move or delete them under Entries first.`
			});
		}

		await db.delete(ticker).where(eq(ticker.id, tickerId));
		return { success: true, message: 'Ticker deleted!' };
	},

	reorderTickers: async ({ request }) => {
		const formData = await request.formData();
		const raw = formData.get('order');
		if (typeof raw !== 'string') {
			return fail(400, { error: 'Missing order' });
		}

		let ids: unknown;
		try {
			ids = JSON.parse(raw);
		} catch {
			return fail(400, { error: 'Invalid order payload' });
		}
		if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
			return fail(400, { error: 'Invalid order payload' });
		}

		for (const [index, id] of (ids as string[]).entries()) {
			await db.update(ticker).set({ sortOrder: index }).where(eq(ticker.id, id));
		}

		return { success: true, message: 'Order saved!' };
	}
};
