import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile, stat, realpath } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

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

	try {
		const fileBuffer = await readFile(filePath);
		const fileStat = await stat(filePath);
		
		// Determine MIME type from extension
		const ext = filename.split('.').pop()?.toLowerCase() || '';
		const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

		return new Response(fileBuffer, {
			headers: {
				'Content-Type': mimeType,
				'Content-Length': fileStat.size.toString(),
				'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year (files are immutable by UUID)
				'Accept-Ranges': 'bytes'
			}
		});
	} catch (err) {
		console.error('Error serving file:', err);
		throw error(500, 'Error reading file');
	}
};
