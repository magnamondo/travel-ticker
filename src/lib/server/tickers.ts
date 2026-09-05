import { and, asc, count, desc, eq, inArray, max, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { isAdmin } from '$lib/roles';
import { getUserGroupIds } from '$lib/server/groups';

/**
 * Route segments that live at the root and must never be shadowed by a ticker.
 * Tickers are served from /t/<slug>, so this only guards against confusing
 * slugs, but it keeps the door open for prettier root-level URLs later.
 */
export const RESERVED_SLUGS = new Set([
	'admin',
	'api',
	'entry',
	'login',
	'logout',
	'profile',
	'register',
	'reset-password',
	'forgot-password',
	'verify-email',
	't'
]);

export function slugify(input: string): string {
	return (
		input
			.normalize('NFKD')
			// strip combining marks so "Lomé" -> "Lome"
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 64)
	);
}

/**
 * Turn a name into a slug that is free and legal, appending -2, -3, ... on
 * collision. `excludeId` lets an existing ticker keep its own slug on rename.
 */
export async function generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
	const base = slugify(name) || 'ticker';
	const rows = await db.select({ id: table.ticker.id, slug: table.ticker.slug }).from(table.ticker);
	const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug));

	let candidate = base;
	let n = 2;
	while (taken.has(candidate) || RESERVED_SLUGS.has(candidate)) {
		candidate = `${base}-${n++}`;
	}
	return candidate;
}

export function validateSlug(slug: string): string | null {
	if (!slug) return 'Slug is required';
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
		return 'Slug may only contain lowercase letters, numbers and single hyphens';
	}
	if (slug.length > 64) return 'Slug must be 64 characters or fewer';
	if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved`;
	return null;
}

/** Admins see drafts; everyone else only published tickers. */
export function canViewUnpublishedTickers(roles: string[] | undefined): boolean {
	return isAdmin(roles);
}

export async function getTickerBySlug(slug: string): Promise<table.Ticker | null> {
	const [row] = await db.select().from(table.ticker).where(eq(table.ticker.slug, slug)).limit(1);
	return row ?? null;
}

export async function getNextTickerSortOrder(): Promise<number> {
	const [row] = await db.select({ maxOrder: max(table.ticker.sortOrder) }).from(table.ticker);
	return (row?.maxOrder ?? -1) + 1;
}

/**
 * Milestone-level group restrictions still apply inside a ticker, so the
 * index counts and "latest entry" have to use the same visibility rules as
 * /api/milestones. Returns a condition to AND into a milestone query, or
 * undefined when the user may see everything.
 */
export async function buildMilestoneVisibilityCondition(
	userId: string | undefined,
	roles: string[] | undefined
) {
	if (isAdmin(roles)) return undefined;

	const restricted = await db
		.select({ milestoneId: table.milestoneGroup.milestoneId })
		.from(table.milestoneGroup);
	const restrictedIds = [...new Set(restricted.map((r) => r.milestoneId))];

	const publishedCondition = eq(table.milestone.published, true);
	if (restrictedIds.length === 0) return publishedCondition;

	const userGroupIds = userId ? await getUserGroupIds(userId) : [];
	let accessibleIds: string[] = [];
	if (userGroupIds.length > 0) {
		const accessible = await db
			.select({ milestoneId: table.milestoneGroup.milestoneId })
			.from(table.milestoneGroup)
			.where(inArray(table.milestoneGroup.groupId, userGroupIds));
		accessibleIds = [...new Set(accessible.map((r) => r.milestoneId))];
	}

	const inaccessibleIds = restrictedIds.filter((id) => !accessibleIds.includes(id));
	if (inaccessibleIds.length === 0) return publishedCondition;
	return and(publishedCondition, notInArray(table.milestone.id, inaccessibleIds));
}

export type TickerSummary = {
	id: string;
	slug: string;
	name: string;
	tagline: string | null;
	description: string | null;
	originLabel: string | null;
	destinationLabel: string | null;
	coverImage: string | null;
	published: boolean;
	createdAt: Date;
	entryCount: number;
	segmentCount: number;
	/** Date of the most recent visible entry, or null when the ticker is empty. */
	latestEntryAt: Date | null;
	/** Up to 4 thumbnails from the newest visible entries, for the index card. */
	previewImages: string[];
};

/**
 * Tickers for the index page, with per-ticker counts that respect the
 * viewer's access. Unpublished tickers are included for admins only.
 */
export async function listTickersForUser(
	userId: string | undefined,
	roles: string[] | undefined
): Promise<TickerSummary[]> {
	const userIsAdmin = isAdmin(roles);

	const tickers = await db
		.select()
		.from(table.ticker)
		.where(userIsAdmin ? undefined : eq(table.ticker.published, true));

	if (tickers.length === 0) return [];

	const visibility = await buildMilestoneVisibilityCondition(userId, roles);

	// One pass over the visible milestones of all tickers; cheaper than a
	// query per ticker and the row set is the same one the timeline pages use.
	const rows = await db
		.select({
			tickerId: table.segment.tickerId,
			segmentId: table.segment.id,
			milestoneId: table.milestone.id,
			date: table.milestone.date
		})
		.from(table.milestone)
		.innerJoin(table.segment, eq(table.milestone.segmentId, table.segment.id))
		.where(visibility)
		.orderBy(desc(table.milestone.date));

	const stats = new Map<
		string,
		{ entryCount: number; segments: Set<string>; latest: Date | null; milestoneIds: string[] }
	>();
	for (const t of tickers) {
		stats.set(t.id, { entryCount: 0, segments: new Set(), latest: null, milestoneIds: [] });
	}
	for (const row of rows) {
		const s = stats.get(row.tickerId);
		if (!s) continue; // milestone belongs to a ticker this user cannot see
		s.entryCount++;
		s.segments.add(row.segmentId);
		if (!s.latest || row.date > s.latest) s.latest = row.date;
		if (s.milestoneIds.length < 8) s.milestoneIds.push(row.milestoneId);
	}

	// Preview thumbnails: images (or video posters) from each ticker's newest entries.
	const previewMilestoneIds = [...stats.values()].flatMap((s) => s.milestoneIds);
	const previewsByMilestone = new Map<string, string[]>();
	if (previewMilestoneIds.length > 0) {
		const media = await db
			.select({
				milestoneId: table.milestoneMedia.milestoneId,
				url: table.milestoneMedia.url,
				type: table.milestoneMedia.type,
				thumbnailUrl: table.milestoneMedia.thumbnailUrl
			})
			.from(table.milestoneMedia)
			.where(inArray(table.milestoneMedia.milestoneId, previewMilestoneIds))
			.orderBy(asc(table.milestoneMedia.sortOrder));

		for (const m of media) {
			const src = m.type === 'video' ? m.thumbnailUrl : m.url;
			if (!src) continue;
			let list = previewsByMilestone.get(m.milestoneId);
			if (!list) {
				list = [];
				previewsByMilestone.set(m.milestoneId, list);
			}
			list.push(src);
		}
	}

	const summaries = tickers.map((t) => {
		const s = stats.get(t.id)!;
		const previewImages: string[] = [];
		for (const milestoneId of s.milestoneIds) {
			for (const src of previewsByMilestone.get(milestoneId) ?? []) {
				if (previewImages.length >= 4) break;
				if (!previewImages.includes(src)) previewImages.push(src);
			}
			if (previewImages.length >= 4) break;
		}

		return {
			id: t.id,
			slug: t.slug,
			name: t.name,
			tagline: t.tagline,
			description: t.description,
			originLabel: t.originLabel,
			destinationLabel: t.destinationLabel,
			coverImage: t.coverImage,
			published: t.published,
			createdAt: t.createdAt,
			entryCount: s.entryCount,
			segmentCount: s.segments.size,
			latestEntryAt: s.latest,
			previewImages
		};
	});

	// Newest first: most recently updated ticker leads. Tickers with no visible
	// entries yet fall back to when they were created, and sort below active ones.
	return summaries.sort((a, b) => {
		const aTime = a.latestEntryAt?.getTime();
		const bTime = b.latestEntryAt?.getTime();
		if (aTime !== undefined && bTime !== undefined) return bTime - aTime;
		if (aTime !== undefined) return -1;
		if (bTime !== undefined) return 1;
		return b.createdAt.getTime() - a.createdAt.getTime();
	});
}

/** Resolve the ticker slug a milestone lives in (for canonical entry URLs). */
export async function getTickerSlugForMilestone(milestoneId: string): Promise<string | null> {
	const [row] = await db
		.select({ slug: table.ticker.slug })
		.from(table.milestone)
		.innerJoin(table.segment, eq(table.milestone.segmentId, table.segment.id))
		.innerJoin(table.ticker, eq(table.segment.tickerId, table.ticker.id))
		.where(eq(table.milestone.id, milestoneId))
		.limit(1);
	return row?.slug ?? null;
}

/** Count of entries per ticker, ignoring visibility. Admin listings only. */
export async function getAdminTickerCounts(): Promise<
	Map<string, { segmentCount: number; entryCount: number }>
> {
	const segmentCounts = await db
		.select({ tickerId: table.segment.tickerId, c: count() })
		.from(table.segment)
		.groupBy(table.segment.tickerId);

	const entryCounts = await db
		.select({ tickerId: table.segment.tickerId, c: count() })
		.from(table.milestone)
		.innerJoin(table.segment, eq(table.milestone.segmentId, table.segment.id))
		.groupBy(table.segment.tickerId);

	const out = new Map<string, { segmentCount: number; entryCount: number }>();
	for (const s of segmentCounts) out.set(s.tickerId, { segmentCount: s.c, entryCount: 0 });
	for (const e of entryCounts) {
		const cur = out.get(e.tickerId) ?? { segmentCount: 0, entryCount: 0 };
		cur.entryCount = e.c;
		out.set(e.tickerId, cur);
	}
	return out;
}
