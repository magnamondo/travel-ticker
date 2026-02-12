import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { uploadSession, milestone } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { isAdmin } from '$lib/roles';

// Use data directory for persistence (works with Docker volume)
const DATA_DIR = process.env.DATA_DIR || 'data';
const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const CHUNK_DIR = join(DATA_DIR, 'uploads', 'chunks');
const DEFAULT_CHUNK_SIZE = 256 * 1024; // 256KB chunks for reliability on bad connections
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB max
const SESSION_EXPIRY_HOURS = 24;

// Ensure upload directories exist
async function ensureDirectories() {
	if (!existsSync(UPLOAD_DIR)) {
		await mkdir(UPLOAD_DIR, { recursive: true });
	}
	if (!existsSync(CHUNK_DIR)) {
		await mkdir(CHUNK_DIR, { recursive: true });
	}
}

// POST: Initialize a new upload session
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}
	if (!isAdmin(locals.user.roles)) {
		throw error(403, 'Only administrators can upload files');
	}

	const body = await request.json();
	const { filename, fileSize, mimeType, milestoneId, chunkSize = DEFAULT_CHUNK_SIZE } = body;

	if (!filename || !fileSize || !mimeType) {
		throw error(400, 'Missing required fields: filename, fileSize, mimeType');
	}

	if (fileSize > MAX_FILE_SIZE) {
		throw error(400, `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
	}

	// Validate milestone exists if provided
	if (milestoneId) {
		const [found] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
		if (!found) {
			throw error(404, 'Milestone not found');
		}
	}

	await ensureDirectories();

	const sessionId = randomUUID();
	const totalChunks = Math.ceil(fileSize / chunkSize);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

	// Create session directory for chunks
	const sessionDir = join(CHUNK_DIR, sessionId);
	await mkdir(sessionDir, { recursive: true });

	await db.insert(uploadSession).values({
		id: sessionId,
		filename,
		fileSize,
		mimeType,
		chunkSize,
		totalChunks,
		uploadedChunks: [],
		status: 'pending',
		milestoneId: milestoneId || null,
		createdAt: now,
		updatedAt: now,
		expiresAt
	});

	return json({
		sessionId,
		chunkSize,
		totalChunks,
		expiresAt: expiresAt.toISOString()
	});
};

// GET: Get upload session status (for resuming)
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}
	if (!isAdmin(locals.user.roles)) {
		throw error(403, 'Only administrators can view upload sessions');
	}

	const sessionId = url.searchParams.get('sessionId');

	if (!sessionId) {
		throw error(400, 'Missing sessionId parameter');
	}

	const [session] = await db.select().from(uploadSession).where(eq(uploadSession.id, sessionId));

	if (!session) {
		throw error(404, 'Upload session not found');
	}

	// Check if session expired
	if (session.expiresAt < new Date()) {
		await cleanupSession(sessionId);
		throw error(410, 'Upload session expired');
	}

	return json({
		sessionId: session.id,
		filename: session.filename,
		fileSize: session.fileSize,
		mimeType: session.mimeType,
		chunkSize: session.chunkSize,
		totalChunks: session.totalChunks,
		uploadedChunks: session.uploadedChunks,
		status: session.status,
		filePath: session.filePath
	});
};

// DELETE: Cancel an upload session
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, 'Not authenticated');
	}
	if (!isAdmin(locals.user.roles)) {
		throw error(403, 'Only administrators can cancel uploads');
	}

	const sessionId = url.searchParams.get('sessionId');

	if (!sessionId) {
		throw error(400, 'Missing sessionId parameter');
	}

	await cleanupSession(sessionId);

	return json({ success: true });
};

async function cleanupSession(sessionId: string) {
	const sessionDir = join(CHUNK_DIR, sessionId);
	
	// Remove chunk files
	if (existsSync(sessionDir)) {
		try {
			const { rm } = await import('fs/promises');
			await rm(sessionDir, { recursive: true });
		} catch {
			// Ignore cleanup errors
		}
	}

	// Remove database record
	await db.delete(uploadSession).where(eq(uploadSession.id, sessionId));
}
