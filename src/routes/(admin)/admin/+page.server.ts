import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { segment, milestone, milestoneMedia, user } from '$lib/server/db/schema';
import { count } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	const [segmentResult] = await db.select({ count: count() }).from(segment);
	const [milestoneResult] = await db.select({ count: count() }).from(milestone);
	const [mediaResult] = await db.select({ count: count() }).from(milestoneMedia);
	const [userResult] = await db.select({ count: count() }).from(user);

	return {
		segmentCount: segmentResult.count,
		milestoneCount: milestoneResult.count,
		mediaCount: mediaResult.count,
		userCount: userResult.count
	};
};
