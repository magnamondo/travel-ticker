import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getVideoJobStatus } from '$lib/server/video';
import { isAdmin } from '$lib/roles';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}
	if (!isAdmin(locals.user.roles)) {
		throw error(403, 'Only administrators can check video status');
	}

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
