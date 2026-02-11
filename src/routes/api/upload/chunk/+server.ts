import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { uploadSession } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { needsTranscoding, queueVideoTranscode } from '$lib/server/video';
import { isHeicFile, convertHeicToJpeg, isImageFile, generateImageThumbnail, resizeImageIfNeeded } from '$lib/server/image';

// Use data directory for persistence (works with Docker volume)
const DATA_DIR = process.env.DATA_DIR || 'data';
const CHUNK_DIR = join(DATA_DIR, 'uploads', 'chunks');
const UPLOAD_DIR = join(DATA_DIR, 'uploads');

interface UploadErrorContext {
	sessionId?: string;
	chunkIndex?: number;
	filename?: string;
	fileSize?: number;
	reason: string;
	details?: Record<string, unknown>;
}

function logUploadError(context: UploadErrorContext, clientIp?: string): void {
	const entry = {
		timestamp: new Date().toISOString(),
		type: 'UPLOAD_ERROR',
		clientIp: clientIp || 'unknown',
		...context
	};
	console.error(JSON.stringify(entry));
}

function getClientIp(request: Request): string {
	return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
		|| request.headers.get('x-real-ip') 
		|| 'unknown';
}

function isConnectionDropError(err: unknown): boolean {
	const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
	const name = (err instanceof Error ? err.name : '').toLowerCase();
	return (
		name === 'aborterror' ||
		message.includes('aborted') ||
		message.includes('econnreset') ||
		message.includes('epipe') ||
		message.includes('connection') ||
		message.includes('socket hang up') ||
		message.includes('client disconnected')
	);
}

// POST: Upload a single chunk
export const POST: RequestHandler = async ({ request }) => {
	const clientIp = getClientIp(request);
	
	// Parse form data with connection drop detection
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (err) {
		if (isConnectionDropError(err)) {
			logUploadError({
				reason: 'connection_dropped',
				details: { 
					error: err instanceof Error ? err.message : String(err),
					stage: 'parsing_formdata'
				}
			}, clientIp);
			throw error(499, 'Client closed connection');
		}
		throw err;
	}
	
	const sessionId = formData.get('sessionId') as string;
	const chunkIndex = parseInt(formData.get('chunkIndex') as string);
	const chunkData = formData.get('chunk') as File;
	const chunkChecksum = formData.get('checksum') as string; // Optional checksum

	if (!sessionId || isNaN(chunkIndex) || !chunkData) {
		logUploadError({
			sessionId: sessionId || undefined,
			chunkIndex: isNaN(chunkIndex) ? undefined : chunkIndex,
			reason: 'missing_fields',
			details: { hasSessionId: !!sessionId, hasChunkIndex: !isNaN(chunkIndex), hasChunkData: !!chunkData }
		}, clientIp);
		throw error(400, 'Missing required fields: sessionId, chunkIndex, chunk');
	}

	// Get session
	const [session] = await db.select().from(uploadSession).where(eq(uploadSession.id, sessionId));

	if (!session) {
		logUploadError({ sessionId, chunkIndex, reason: 'session_not_found' }, clientIp);
		throw error(404, 'Upload session not found');
	}

	if (session.status === 'completed') {
		logUploadError({ 
			sessionId, chunkIndex, 
			filename: session.filename,
			reason: 'already_completed' 
		}, clientIp);
		throw error(400, 'Upload already completed');
	}

	if (session.expiresAt < new Date()) {
		logUploadError({ 
			sessionId, chunkIndex, 
			filename: session.filename,
			reason: 'session_expired',
			details: { expiresAt: session.expiresAt.toISOString() }
		}, clientIp);
		throw error(410, 'Upload session expired');
	}

	if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
		logUploadError({
			sessionId, chunkIndex,
			filename: session.filename,
			reason: 'invalid_chunk_index',
			details: { totalChunks: session.totalChunks }
		}, clientIp);
		throw error(400, `Invalid chunk index. Expected 0-${session.totalChunks - 1}`);
	}

	// Skip if chunk already uploaded
	if (session.uploadedChunks.includes(chunkIndex)) {
		return json({
			success: true,
			chunkIndex,
			alreadyUploaded: true,
			uploadedChunks: session.uploadedChunks,
			progress: (session.uploadedChunks.length / session.totalChunks) * 100
		});
	}

	// Read chunk data with connection drop detection
	let buffer: Buffer;
	try {
		buffer = Buffer.from(await chunkData.arrayBuffer());
	} catch (err) {
		if (isConnectionDropError(err)) {
			logUploadError({
				sessionId, chunkIndex,
				filename: session.filename,
				reason: 'connection_dropped',
				details: { 
					error: err instanceof Error ? err.message : String(err),
					stage: 'reading_chunk_data'
				}
			}, clientIp);
			throw error(499, 'Client closed connection');
		}
		throw err;
	}

	// Verify checksum if provided
	if (chunkChecksum) {
		// Use SHA-256 truncated to 32 chars to match client-side computation
		const computedChecksum = createHash('sha256').update(buffer).digest('hex').substring(0, 32);
		if (computedChecksum !== chunkChecksum) {
			logUploadError({
				sessionId, chunkIndex,
				filename: session.filename,
				fileSize: session.fileSize,
				reason: 'checksum_mismatch',
				details: { 
					expected: chunkChecksum, 
					computed: computedChecksum,
					chunkSize: buffer.length
				}
			}, clientIp);
			throw error(400, 'Chunk checksum mismatch - data corrupted during transfer');
		}
	}

	// Write chunk to disk
	const sessionDir = join(CHUNK_DIR, sessionId);
	const chunkPath = join(sessionDir, `chunk_${chunkIndex.toString().padStart(6, '0')}`);
	await writeFile(chunkPath, buffer);

	// Re-fetch session to get latest uploadedChunks (avoid race condition with parallel uploads)
	const [latestSession] = await db.select().from(uploadSession).where(eq(uploadSession.id, sessionId));
	if (!latestSession) {
		logUploadError({ 
			sessionId, chunkIndex,
			filename: session.filename, 
			reason: 'session_disappeared_after_write'
		}, clientIp);
		throw error(404, 'Upload session not found');
	}

	// Update session with new chunk (only if not already present)
	const existingChunks = new Set(latestSession.uploadedChunks);
	if (!existingChunks.has(chunkIndex)) {
		existingChunks.add(chunkIndex);
	}
	const newUploadedChunks = Array.from(existingChunks).sort((a, b) => a - b);
	const newStatus = newUploadedChunks.length === latestSession.totalChunks ? 'uploading' : latestSession.status === 'pending' ? 'uploading' : latestSession.status;

	await db.update(uploadSession)
		.set({
			uploadedChunks: newUploadedChunks,
			status: newStatus,
			updatedAt: new Date()
		})
		.where(eq(uploadSession.id, sessionId));

	const progress = (newUploadedChunks.length / session.totalChunks) * 100;

	return json({
		success: true,
		chunkIndex,
		uploadedChunks: newUploadedChunks,
		progress,
		isComplete: newUploadedChunks.length === session.totalChunks
	});
};

// PUT: Complete the upload - assemble chunks into final file
export const PUT: RequestHandler = async ({ request }) => {
	const clientIp = getClientIp(request);
	const body = await request.json();
	const { sessionId, fileChecksum } = body;

	if (!sessionId) {
		logUploadError({ reason: 'missing_session_id_on_complete' }, clientIp);
		throw error(400, 'Missing sessionId');
	}

	const [session] = await db.select().from(uploadSession).where(eq(uploadSession.id, sessionId));

	if (!session) {
		logUploadError({ sessionId, reason: 'session_not_found_on_complete' }, clientIp);
		throw error(404, 'Upload session not found');
	}

	if (session.status === 'completed') {
		return json({
			success: true,
			url: session.filePath,
			alreadyCompleted: true
		});
	}

	// Verify all chunks are uploaded
	if (session.uploadedChunks.length !== session.totalChunks) {
		const missing = [];
		for (let i = 0; i < session.totalChunks; i++) {
			if (!session.uploadedChunks.includes(i)) {
				missing.push(i);
			}
		}
		logUploadError({
			sessionId,
			filename: session.filename,
			fileSize: session.fileSize,
			reason: 'missing_chunks_on_complete',
			details: { 
				uploaded: session.uploadedChunks.length, 
				total: session.totalChunks,
				missingCount: missing.length,
				missingSample: missing.slice(0, 10)
			}
		}, clientIp);
		throw error(400, `Missing chunks: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}`);
	}

	const sessionDir = join(CHUNK_DIR, sessionId);

	// Read and assemble all chunks
	const chunks: Buffer[] = [];
	for (let i = 0; i < session.totalChunks; i++) {
		const chunkPath = join(sessionDir, `chunk_${i.toString().padStart(6, '0')}`);
		if (!existsSync(chunkPath)) {
			logUploadError({
				sessionId,
				chunkIndex: i,
				filename: session.filename,
				reason: 'chunk_file_missing',
				details: { path: chunkPath }
			}, clientIp);
			throw error(500, `Chunk ${i} file missing`);
		}
		chunks.push(await readFile(chunkPath));
	}

	const fileBuffer = Buffer.concat(chunks);

	// Verify file size
	if (fileBuffer.length !== session.fileSize) {
		logUploadError({
			sessionId,
			filename: session.filename,
			fileSize: session.fileSize,
			reason: 'file_size_mismatch',
			details: { expected: session.fileSize, actual: fileBuffer.length }
		}, clientIp);
		throw error(400, `File size mismatch: expected ${session.fileSize}, got ${fileBuffer.length}`);
	}

	// Compute file checksum using SHA-256 (truncated to 32 chars to match client)
	const computedChecksum = createHash('sha256').update(fileBuffer).digest('hex').substring(0, 32);

	// Verify checksum if provided
	if (fileChecksum) {
		if (computedChecksum !== fileChecksum) {
			logUploadError({
				sessionId,
				filename: session.filename,
				fileSize: session.fileSize,
				reason: 'file_checksum_mismatch',
				details: { expected: fileChecksum, computed: computedChecksum }
			}, clientIp);
			throw error(400, 'File checksum mismatch - data corrupted');
		}
	}

	// Generate unique filename
	const ext = session.filename.split('.').pop() || '';
	const uniqueFilename = `${sessionId}.${ext}`;
	const finalPath = join(UPLOAD_DIR, uniqueFilename);
	const publicUrl = `/api/uploads/${uniqueFilename}`;

	// Write final file
	await writeFile(finalPath, fileBuffer);

	let resultUrl = publicUrl;
	let thumbnailUrl: string | undefined;
	let videoDuration: number | undefined;
	let videoProcessingJobId: string | undefined;
	let finalMimeType = session.mimeType;
	let finalFilename = session.filename;

	// Convert HEIC/HEIF images to JPEG
	if (isHeicFile(session.mimeType, session.filename)) {
		const conversionResult = await convertHeicToJpeg(finalPath);
		if (conversionResult.success && conversionResult.outputPath) {
			// Update paths and mime type for the converted file
			const newFilename = `${sessionId}.jpg`;
			resultUrl = `/api/uploads/${newFilename}`;
			finalMimeType = 'image/jpeg';
			finalFilename = conversionResult.filename || finalFilename;
		} else {
			console.error('HEIC conversion failed:', conversionResult.error);
			// Continue with original file if conversion fails
		}
	}

	// Process images: resize if needed and always strip metadata (EXIF, GPS, etc.) for privacy
	if (isImageFile(finalMimeType)) {
		const actualFilename = resultUrl.replace('/api/uploads/', '');
		const imagePath = join(UPLOAD_DIR, actualFilename);
		
		const resizeResult = await resizeImageIfNeeded(imagePath);
		if (!resizeResult.success) {
			console.error('Image processing failed:', resizeResult.error);
			// Continue with original if processing fails
		}
	}

	// Generate thumbnail for image files
	if (isImageFile(finalMimeType)) {
		// Determine the actual file path (may have changed after HEIC conversion)
		const actualFilename = resultUrl.replace('/api/uploads/', '');
		const imagePath = join(UPLOAD_DIR, actualFilename);
		
		const thumbResult = await generateImageThumbnail(imagePath);
		if (thumbResult.success && thumbResult.filename) {
			thumbnailUrl = `/api/uploads/${thumbResult.filename}`;
		} else {
			console.error('Thumbnail generation failed:', thumbResult.error);
			// Continue without thumbnail if generation fails
		}
	}

	// Process video files
	if (session.mimeType.startsWith('video/')) {
		// Queue video for background processing - don't block the request
		videoProcessingJobId = sessionId;
		queueVideoTranscode(finalPath, sessionId, session.mimeType, session.filename);
		
		// Return immediately - client will poll for status
		// For now, return the original URL (will be updated when processing completes)
	}

	// Update session as completed
	await db.update(uploadSession)
		.set({
			status: 'completed',
			filePath: resultUrl,
			checksum: computedChecksum,
			updatedAt: new Date()
		})
		.where(eq(uploadSession.id, sessionId));

	// Cleanup chunk files
	try {
		const { rm } = await import('fs/promises');
		await rm(sessionDir, { recursive: true });
	} catch {
		// Ignore cleanup errors
	}

	return json({
		success: true,
		url: resultUrl,
		filename: finalFilename,
		fileSize: session.fileSize,
		mimeType: finalMimeType,
		checksum: computedChecksum,
		thumbnailUrl,
		duration: videoDuration,
		videoProcessingJobId // Client uses this to poll for transcoding status
	});
};
