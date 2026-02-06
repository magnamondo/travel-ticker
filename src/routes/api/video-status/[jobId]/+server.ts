import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getVideoJobStatus } from '$lib/server/video';

export const GET: RequestHandler = async ({ params }) => {
	const { jobId } = params;

	if (!jobId) {
		throw error(400, 'Missing jobId');
	}

	const status = await getVideoJobStatus(jobId);

	if (!status) {
		throw error(404, 'Video job not found');
	}

	return json(status);
};
