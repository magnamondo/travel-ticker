import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { videoJob } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
	const jobs = await db.select().from(videoJob).orderBy(desc(videoJob.createdAt));

	// Calculate stats
	const stats = {
		total: jobs.length,
		pending: jobs.filter(j => j.status === 'pending').length,
		processing: jobs.filter(j => j.status === 'processing').length,
		completed: jobs.filter(j => j.status === 'completed').length,
		failed: jobs.filter(j => j.status === 'failed').length
	};

	return {
		jobs,
		stats
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
