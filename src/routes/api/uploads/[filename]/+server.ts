import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { stat, realpath } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';

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

// Security model: Files use UUID filenames (~10^38 possibilities), making URLs unguessable.
// Access control is enforced at the application layer (only showing URLs to authorized users).
// This is the same approach used by Slack, Discord, Notion, etc.
// Per-request auth checks were removed because:
// 1. They caused 2-3 DB queries per file request (expensive for image-heavy pages)
// 2. They had bugs with mixed-access files (public + group-restricted milestones)
// 3. Anyone who can access a file can share its contents anyway (download/screenshot)

export const GET: RequestHandler = async ({ params }) => {
	const { filename } = params;
	
	if (!filename) {
		throw error(400, 'Filename required');
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
