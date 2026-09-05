import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { ticker, segment, milestone, milestoneMedia, user, comment } from '$lib/server/db/schema';
import { count } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	const [tickerResult] = await db.select({ count: count() }).from(ticker);
	const [segmentResult] = await db.select({ count: count() }).from(segment);
	const [milestoneResult] = await db.select({ count: count() }).from(milestone);
	const [mediaResult] = await db.select({ count: count() }).from(milestoneMedia);
	const [userResult] = await db.select({ count: count() }).from(user);
	const [commentResult] = await db.select({ count: count() }).from(comment);

	return {
		tickerCount: tickerResult.count,
		segmentCount: segmentResult.count,
		milestoneCount: milestoneResult.count,
		mediaCount: mediaResult.count,
		userCount: userResult.count,
		commentCount: commentResult.count
	};
};
