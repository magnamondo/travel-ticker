import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { videoJob } from '$lib/server/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

const PAGE_SIZE = 10;

export const load: PageServerLoad = async ({ url }) => {
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
	const offset = (page - 1) * PAGE_SIZE;

	// Get paginated jobs
	const jobs = await db.select()
		.from(videoJob)
		.orderBy(desc(videoJob.createdAt))
		.limit(PAGE_SIZE)
		.offset(offset);

	// Get stats using SQL count for efficiency
	const statsResult = await db.select({
		total: sql<number>`count(*)`,
		pending: sql<number>`count(*) filter (where ${videoJob.status} = 'pending')`,
		processing: sql<number>`count(*) filter (where ${videoJob.status} = 'processing')`,
		completed: sql<number>`count(*) filter (where ${videoJob.status} = 'completed')`,
		failed: sql<number>`count(*) filter (where ${videoJob.status} = 'failed')`
	}).from(videoJob);

	const stats = statsResult[0] ?? { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 };
	const totalPages = Math.ceil(stats.total / PAGE_SIZE);

	return {
		jobs,
		stats,
		pagination: {
			page,
			pageSize: PAGE_SIZE,
			totalPages,
			total: stats.total
		}
	};
};

export const actions: Actions = {
	delete: async ({ request }) => {
		const formData = await request.formData();
		const jobId = formData.get('jobId') as string;

		if (!jobId) {
			return fail(400, { error: 'Job ID required' });
		}

		await db.delete(videoJob).where(eq(videoJob.id, jobId));

		return { success: true, message: 'Job deleted' };
	},

	deleteAll: async ({ request }) => {
		const formData = await request.formData();
		const status = formData.get('status') as string;

		if (status === 'completed') {
			await db.delete(videoJob).where(eq(videoJob.status, 'completed'));
		} else if (status === 'failed') {
			await db.delete(videoJob).where(eq(videoJob.status, 'failed'));
		} else if (status === 'all') {
			await db.delete(videoJob);
		}

		return { success: true, message: 'Jobs deleted' };
	},

	retry: async ({ request }) => {
		const formData = await request.formData();
		const jobId = formData.get('jobId') as string;

		if (!jobId) {
			return fail(400, { error: 'Job ID required' });
		}

		await db.update(videoJob)
			.set({ 
				status: 'pending', 
				error: null, 
				progress: 0,
				updatedAt: new Date() 
			})
			.where(eq(videoJob.id, jobId));

		return { success: true, message: 'Job queued for retry' };
	}
};
