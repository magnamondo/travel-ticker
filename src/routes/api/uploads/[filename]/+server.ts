import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { stat, realpath } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { db } from '$lib/server/db';
import { milestoneMedia, milestoneGroup } from '$lib/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { getUserGroupIds } from '$lib/server/groups';
import { isAdmin } from '$lib/roles';

// Use data directory for persistence (works with Docker volume)
const DATA_DIR = process.env.DATA_DIR || 'data';
const UPLOAD_DIR = join(DATA_DIR, 'uploads');

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
	'jpg': 'image/jpeg',
	'jpeg': 'image/jpeg',
	'png': 'image/png',
	'gif': 'image/gif',
	'webp': 'image/webp',
	'svg': 'image/svg+xml',
	'mp4': 'video/mp4',
	'webm': 'video/webm',
	'mov': 'video/quicktime',
	'avi': 'video/x-msvideo',
	'mkv': 'video/x-matroska',
	'pdf': 'application/pdf',
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const { filename } = params;
	
	if (!filename) {
		throw error(400, 'Filename required');
	}

	// Check group-based access control
	const mediaUrl = `/api/uploads/${filename}`;
	const mediaRecords = await db
		.select({ milestoneId: milestoneMedia.milestoneId })
		.from(milestoneMedia)
		.where(eq(milestoneMedia.url, mediaUrl));

	if (mediaRecords.length > 0) {
		// Check if any of the milestones are group-restricted
		const milestoneIds = [...new Set(mediaRecords.map(m => m.milestoneId))];
		const restrictions = await db
			.select({ milestoneId: milestoneGroup.milestoneId, groupId: milestoneGroup.groupId })
			.from(milestoneGroup)
			.where(inArray(milestoneGroup.milestoneId, milestoneIds));

		if (restrictions.length > 0) {
			// File belongs to group-restricted milestone(s)
			// Admins can access all
			if (locals.user && isAdmin(locals.user.roles)) {
				// Allow
			} else if (!locals.user) {
				throw error(401, 'Authentication required');
			} else {
				// Check if user is in any of the required groups
				const requiredGroupIds = [...new Set(restrictions.map(r => r.groupId))];
				const userGroupIds = await getUserGroupIds(locals.user.id);
				const hasAccess = requiredGroupIds.some(gid => userGroupIds.includes(gid));
				if (!hasAccess) {
					throw error(403, 'You do not have access to this file');
				}
			}
		}
	}

	// Security: prevent directory traversal
	// Check for obvious traversal attempts
	if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
		throw error(400, 'Invalid filename');
	}

	// Decode and re-check (handles %2e%2e etc)
	const decodedFilename = decodeURIComponent(filename);
	if (decodedFilename.includes('..') || decodedFilename.includes('/') || decodedFilename.includes('\\')) {
		throw error(400, 'Invalid filename');
	}

	// Only allow alphanumeric, dash, underscore, and dot
	if (!/^[a-zA-Z0-9._-]+$/.test(decodedFilename)) {
		throw error(400, 'Invalid filename characters');
	}

	const filePath = join(UPLOAD_DIR, decodedFilename);

	if (!existsSync(filePath)) {
		throw error(404, 'File not found');
	}

	// Final safety check: resolve real path and verify it's inside UPLOAD_DIR
	const realFilePath = await realpath(filePath);
	const realUploadDir = await realpath(UPLOAD_DIR);
	if (!realFilePath.startsWith(realUploadDir + '/')) {
		throw error(403, 'Access denied');
	}

	// Optimization: Use X-Accel-Redirect (X-Sendfile) to let Caddy serve the file.
	// This frees up Node.js Event Loop and Memory immediately.
	// We send '/filename' (with leading slash). Caddy will join it with the internal uploads root.
	if (!dev) {
		const redirectPath = `/${decodedFilename}`;
		
		return new Response(null, {
			headers: {
				'X-Accel-Redirect': redirectPath,
			}
		});
	}

	const extension = decodedFilename.split('.').pop()?.toLowerCase() || '';
	const contentType = MIME_TYPES[extension] || 'application/octet-stream';
	const stats = await stat(realFilePath);
	
	const stream = createReadStream(realFilePath);
	// @ts-ignore - Readable.toWeb matches ReadableStream but TS might complain about exact match in some envs
	const webStream = Readable.toWeb(stream);
	
	return new Response(webStream as any, {
		headers: {
			'Content-Type': contentType,
			'Content-Length': stats.size.toString()
		}
	});
};
