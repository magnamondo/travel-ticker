import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';

/**
 * Client-side error reporting endpoint
 * Logs to stdout for visibility in docker logs (no persistent storage)
 * Rate limited by Caddy to prevent abuse
 */
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	try {
		const body = await request.json();
		
		const {
			type,          // e.g., 'upload_error', 'api_error'
			status,        // HTTP status code if applicable
			url,           // URL that failed
			message,       // Error message
			context        // Additional context (optional)
		} = body;

		// Log to stderr for visibility
		console.error(JSON.stringify({
			timestamp: new Date().toISOString(),
			type: 'CLIENT_ERROR',
			errorType: type || 'unknown',
			status: status || null,
			url: url || null,
			message: message || 'No message provided',
			context: context || null,
			userId: locals.user?.id || null,
			clientIp: getClientAddress()
		}));

		return json({ ok: true });
	} catch {
		// Don't fail even if the error report itself is malformed
		return json({ ok: false }, { status: 400 });
	}
};
