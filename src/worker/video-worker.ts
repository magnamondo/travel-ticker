/**
 * Video Processing Worker
 * 
 * Runs as a separate process from the HTTP server.
 * Polls the database for pending video jobs and processes them.
 * 
 * Usage: npx tsx src/worker/video-worker.ts
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, sql } from 'drizzle-orm';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { unlink, rename } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { config } from 'dotenv';

// Load .env file for local development
config();

// Initialize database connection
const DATABASE_URL = process.env.DATABASE_URL || 'data/db/database.db';
const sqlite = new Database(DATABASE_URL);

// Enable WAL mode for better concurrency (allows reads while writing)
// Required for multi-process access (web server + video worker)
sqlite.pragma('journal_mode = WAL');

// Set busy timeout to 5 seconds - throws error instead of blocking forever
// This ensures we get a visible error instead of a frozen process
sqlite.pragma('busy_timeout = 5000');

const db = drizzle(sqlite);

// Import schema (inline to avoid SvelteKit imports)
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

const videoJob = sqliteTable('video_job', {
	id: text('id').primaryKey(),
	inputPath: text('input_path').notNull(),
	mimeType: text('mime_type').notNull(),
	filename: text('filename').notNull(),
	status: text('status', { enum: ['pending', 'processing', 'completed', 'failed', 'dead-letter'] }).notNull().default('pending'),
	progress: integer('progress').default(0),
	retryCount: integer('retry_count').default(0).notNull(),
	resultUrl: text('result_url'),
	thumbnailUrl: text('thumbnail_url'),
	duration: integer('duration'),
	error: text('error'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	startedAt: integer('started_at', { mode: 'timestamp' }),
	completedAt: integer('completed_at', { mode: 'timestamp' })
});

// milestone_media table to update final URLs after processing
const milestoneMedia = sqliteTable('milestone_media', {
	id: text('id').primaryKey(),
	milestoneId: text('milestone_id').notNull(),
	type: text('type', { enum: ['image', 'video'] }).notNull(),
	url: text('url').notNull(),
	thumbnailUrl: text('thumbnail_url'),
	caption: text('caption'),
	duration: integer('duration'),
	videoJobId: text('video_job_id'),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

const POLL_INTERVAL = 2000; // 2 seconds
const MAX_RETRIES = 3; // Maximum retry attempts before dead-letter
const MILESTONE_MEDIA_RETRY_DELAY = 500; // ms between retries
const MILESTONE_MEDIA_MAX_RETRIES = 20; // 10 seconds total
let isProcessing = false;
let shouldExit = false;

/**
 * Update milestone_media with retry logic.
 * milestone_media may not exist yet due to race condition with form submission.
 */
async function updateMilestoneMedia(
	jobId: string, 
	data: { url?: string; thumbnailUrl?: string | null; duration?: number }
): Promise<boolean> {
	for (let attempt = 0; attempt < MILESTONE_MEDIA_MAX_RETRIES; attempt++) {
		const result = await db.update(milestoneMedia)
			.set(data)
			.where(eq(milestoneMedia.videoJobId, jobId))
			.returning({ milestoneId: milestoneMedia.milestoneId });
		
		// Check if any rows were updated
		if (result.length > 0) {
			return true;
		}
		
		// Wait before retrying
		await new Promise(resolve => setTimeout(resolve, MILESTONE_MEDIA_RETRY_DELAY));
	}
	
	console.log(`  ⚠️  Could not update milestone_media for job ${jobId} (may not exist yet)`);
	return false;
}

console.log('🎬 Video Worker starting...');
console.log(`📂 Database: ${DATABASE_URL}`);

// Graceful shutdown
process.on('SIGINT', () => {
	console.log('\n⏹️  Shutting down gracefully...');
	shouldExit = true;
});

process.on('SIGTERM', () => {
	console.log('\n⏹️  Received SIGTERM, shutting down...');
	shouldExit = true;
});

async function isFFmpegAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('ffmpeg', ['-version']);
		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}

// Maximum video dimensions: 1080p (1920x1080)
// This is the web standard - good balance between quality and file size
// 4K would be 4x the file size with minimal perceptible quality gain for most viewers
const MAX_VIDEO_WIDTH = 1920;
const MAX_VIDEO_HEIGHT = 1080;

// Thumbnail size matching image.ts for consistent grid layout
const THUMBNAIL_SIZE = 600;

interface VideoDimensions {
	width: number;
	height: number;
}

async function getVideoDimensions(inputPath: string): Promise<VideoDimensions | null> {
	return new Promise((resolve) => {
		const proc = spawn('ffprobe', [
			'-v', 'error',
			'-select_streams', 'v:0',
			'-show_entries', 'stream=width,height',
			'-of', 'csv=s=x:p=0',
			inputPath
		]);

		let output = '';
		proc.stdout.on('data', (data) => {
			output += data.toString();
		});

		proc.on('error', () => resolve(null));
		proc.on('close', (code) => {
			if (code === 0) {
				const match = output.trim().match(/^(\d+)x(\d+)$/);
				if (match) {
					resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
				} else {
					resolve(null);
				}
			} else {
				resolve(null);
			}
		});
	});
}

function needsResizing(dimensions: VideoDimensions | null): boolean {
	if (!dimensions) return false;
	return dimensions.width > MAX_VIDEO_WIDTH || dimensions.height > MAX_VIDEO_HEIGHT;
}

async function getVideoDuration(inputPath: string): Promise<number> {
	return new Promise((resolve) => {
		const proc = spawn('ffprobe', [
			'-v', 'error',
			'-show_entries', 'format=duration',
			'-of', 'default=noprint_wrappers=1:nokey=1',
			inputPath
		]);

		let output = '';
		proc.stdout.on('data', (data) => {
			output += data.toString();
		});

		proc.on('error', () => resolve(0));
		proc.on('close', (code) => {
			if (code === 0) {
				const duration = parseFloat(output.trim());
				resolve(isNaN(duration) ? 0 : duration);
			} else {
				resolve(0);
			}
		});
	});
}

function needsTranscoding(mimeType: string, filename: string): boolean {
	const webCompatible = ['video/mp4', 'video/webm'];
	if (webCompatible.includes(mimeType)) return false;
	
	const ext = extname(filename).toLowerCase();
	const webCompatibleExts = ['.mp4', '.webm'];
	return !webCompatibleExts.includes(ext);
}

/**
 * Check if an MP4 file has faststart (moov atom before mdat)
 * Reads first 64 bytes and checks atom order
 */
async function hasFaststart(filePath: string): Promise<boolean> {
	return new Promise((resolve) => {
		// Use ffprobe to check if moov is at start
		const proc = spawn('ffprobe', [
			'-v', 'error',
			'-show_entries', 'format_tags=',
			'-of', 'default=noprint_wrappers=1',
			filePath
		]);

		// As a simpler fallback: read first 4KB and look for 'moov' before 'mdat'
		proc.on('close', async () => {
			try {
				const { createReadStream } = await import('fs');
				const chunks: Buffer[] = [];
				const stream = createReadStream(filePath, { start: 0, end: 4095 });
				
				for await (const chunk of stream) {
					chunks.push(chunk as Buffer);
				}
				
				const buffer = Buffer.concat(chunks);
				const data = buffer.toString('binary');
				const moovIndex = data.indexOf('moov');
				const mdatIndex = data.indexOf('mdat');
				
				// faststart = moov comes before mdat (or mdat not in first 4KB)
				if (moovIndex >= 0 && (mdatIndex < 0 || moovIndex < mdatIndex)) {
					resolve(true);
				} else if (mdatIndex >= 0 && moovIndex < 0) {
					// mdat found but no moov in first 4KB = not faststart
					resolve(false);
				} else {
					// Neither found in first 4KB, assume needs processing
					resolve(false);
				}
			} catch {
				// On error, assume needs faststart
				resolve(false);
			}
		});
	});
}

/**
 * Remux MP4 with faststart (moov at beginning) without re-encoding
 * This is fast since it only moves metadata around
 */
async function ensureFaststart(inputPath: string): Promise<{ success: boolean; outputPath: string }> {
	const dir = dirname(inputPath);
	const ext = extname(inputPath);
	const name = basename(inputPath, ext);
	const tempPath = join(dir, `${name}_faststart${ext}`);

	const success = await new Promise<boolean>((resolve) => {
		const proc = spawn('ffmpeg', [
			'-i', inputPath,
			'-c', 'copy',           // No re-encoding, just remux
			'-movflags', '+faststart',
			'-y',
			tempPath
		]);

		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});

	if (success) {
		// Delete original and rename
		await unlink(inputPath);
		await rename(tempPath, inputPath);
		return { success: true, outputPath: inputPath };
	}

	// Cleanup temp file on failure
	try {
		if (existsSync(tempPath)) {
			await unlink(tempPath);
		}
	} catch {
		// Ignore cleanup errors
	}

	return { success: false, outputPath: inputPath };
}

/**
 * Convert a JPEG to progressive encoding using ImageMagick
 * Modifies file in-place
 */
async function makeProgressiveJpeg(inputPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn('magick', [
			inputPath,
			'-interlace', 'Plane',
			inputPath
		]);
		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error('ImageMagick progressive conversion failed'));
			}
		});
	});
}

async function generateThumbnail(inputPath: string, outputPath: string, timeOffset = 1): Promise<boolean> {
	const success = await new Promise<boolean>((resolve) => {
		// Center-cropped square thumbnail matching image thumbnails
		const proc = spawn('ffmpeg', [
			'-i', inputPath,
			'-ss', timeOffset.toString(),
			'-vframes', '1',
			'-vf', `scale=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}:force_original_aspect_ratio=increase,crop=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}`,
			'-y',
			outputPath
		]);

		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});

	if (success) {
		// Convert to progressive JPEG
		try {
			await makeProgressiveJpeg(outputPath);
		} catch {
			// Ignore - baseline JPEG is acceptable fallback
		}
	}

	return success;
}

/**
 * Transcode video to H.264 MP4 with max dimensions 1920x1080
 */
async function transcodeVideo(inputPath: string, outputPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		// Scale filter: only scale if larger than 1920x1080, maintain aspect ratio
		const scaleFilter = `scale='min(${MAX_VIDEO_WIDTH},iw)':'min(${MAX_VIDEO_HEIGHT},ih)':force_original_aspect_ratio=decrease`;
		
		const proc = spawn('ffmpeg', [
			'-i', inputPath,
			'-vf', scaleFilter,
			'-c:v', 'libx264',
			'-preset', 'medium',
			'-crf', '23',
			'-c:a', 'aac',
			'-b:a', '128k',
			'-movflags', '+faststart',
			'-y',
			outputPath
		]);

		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}

/**
 * Resize video to max 1920x1080 without changing codec (for already web-compatible videos)
 * Returns true if resize was performed, false if not needed or failed
 */
async function resizeVideoIfNeeded(inputPath: string, dimensions: VideoDimensions | null): Promise<{ success: boolean; outputPath: string }> {
	if (!dimensions || !needsResizing(dimensions)) {
		return { success: true, outputPath: inputPath };
	}

	const dir = dirname(inputPath);
	const ext = extname(inputPath);
	const name = basename(inputPath, ext);
	const tempPath = join(dir, `${name}_resized${ext}`);

	const success = await new Promise<boolean>((resolve) => {
		// Scale filter: only scale if larger than 1920x1080, maintain aspect ratio
		const scaleFilter = `scale='min(${MAX_VIDEO_WIDTH},iw)':'min(${MAX_VIDEO_HEIGHT},ih)':force_original_aspect_ratio=decrease`;
		
		const proc = spawn('ffmpeg', [
			'-i', inputPath,
			'-vf', scaleFilter,
			'-c:v', 'libx264',
			'-preset', 'medium',
			'-crf', '23',
			'-c:a', 'aac',
			'-b:a', '128k',
			'-movflags', '+faststart',
			'-y',
			tempPath
		]);

		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});

	if (success) {
		// Delete original and rename
		await unlink(inputPath);
		await rename(tempPath, inputPath);
		console.log(`  📐 Resized video from ${dimensions.width}x${dimensions.height} to max ${MAX_VIDEO_WIDTH}x${MAX_VIDEO_HEIGHT}`);
		return { success: true, outputPath: inputPath };
	}

	// Cleanup temp file on failure
	try {
		if (existsSync(tempPath)) {
			await unlink(tempPath);
		}
	} catch {
		// Ignore cleanup errors
	}

	return { success: false, outputPath: inputPath };
}

async function processJob(job: typeof videoJob.$inferSelect): Promise<void> {
	const jobId = job.id;
	console.log(`🎬 Processing job ${jobId}: ${job.filename}`);

	// Mark as processing
	await db.update(videoJob)
		.set({ 
			status: 'processing', 
			startedAt: new Date(),
			updatedAt: new Date() 
		})
		.where(eq(videoJob.id, jobId));

	try {
		if (!existsSync(job.inputPath)) {
			throw new Error(`Input file not found: ${job.inputPath}`);
		}

		const dir = dirname(job.inputPath);
		const name = basename(job.inputPath, extname(job.inputPath));
		const duration = await getVideoDuration(job.inputPath);

		let resultUrl = `/api/uploads/${basename(job.inputPath)}`;
		let thumbnailUrl: string | undefined;
		let finalPath = job.inputPath;

		// STEP 1: Generate thumbnail FIRST (from original file)
		// This way users see a thumbnail immediately while transcoding happens
		console.log(`  🖼️  Generating thumbnail...`);
		const thumbnailPath = join(dir, `${name}_thumb.jpg`);
		const thumbTime = Math.min(1, duration * 0.1);
		const thumbSuccess = await generateThumbnail(job.inputPath, thumbnailPath, thumbTime);
		
		if (thumbSuccess && existsSync(thumbnailPath)) {
			thumbnailUrl = `/api/uploads/${basename(thumbnailPath)}`;
			console.log(`  ✅ Thumbnail generated`);
			
			// Update the job record immediately
			await db.update(videoJob)
				.set({ thumbnailUrl, updatedAt: new Date() })
				.where(eq(videoJob.id, jobId));
			
			// Try to update milestone_media (may not exist yet due to race condition)
			await updateMilestoneMedia(jobId, { thumbnailUrl });
		}

		// STEP 2: Get dimensions and check if resize/transcode is needed
		const dimensions = await getVideoDimensions(job.inputPath);
		
		if (needsTranscoding(job.mimeType, job.filename)) {
			// Transcode to H.264 MP4 (includes resizing to max 1920x1080)
			console.log(`  📹 Transcoding to H.264 MP4...`);
			if (dimensions) {
				console.log(`  📐 Original dimensions: ${dimensions.width}x${dimensions.height}`);
			}
			const outputPath = join(dir, `${name}_web.mp4`);
			
			const success = await transcodeVideo(job.inputPath, outputPath);
			if (!success) {
				throw new Error('Transcoding failed');
			}

			// Delete original and rename
			await unlink(job.inputPath);
			finalPath = job.inputPath.replace(extname(job.inputPath), '.mp4');
			await rename(outputPath, finalPath);
			
			resultUrl = `/api/uploads/${basename(finalPath)}`;
			console.log(`  ✅ Transcoding complete`);
		} else if (needsResizing(dimensions)) {
			// Video is already web-compatible but needs resizing
			console.log(`  📐 Resizing video (dimensions: ${dimensions?.width}x${dimensions?.height})...`);
			const resizeResult = await resizeVideoIfNeeded(job.inputPath, dimensions);
			if (!resizeResult.success) {
				throw new Error('Video resize failed');
			}
			finalPath = resizeResult.outputPath;
			resultUrl = `/api/uploads/${basename(finalPath)}`;
			console.log(`  ✅ Resize complete`);
		} else {
			// Video is web-compatible and doesn't need resizing
			// But we still need to ensure faststart for streaming
			const ext = extname(job.filename).toLowerCase();
			if (ext === '.mp4' || job.mimeType === 'video/mp4') {
				const hasFS = await hasFaststart(job.inputPath);
				if (!hasFS) {
					console.log(`  ⚡ Applying faststart for streaming optimization...`);
					const fsResult = await ensureFaststart(job.inputPath);
					if (!fsResult.success) {
						console.warn(`  ⚠️ Faststart failed, video may buffer on playback`);
					} else {
						console.log(`  ✅ Faststart applied`);
					}
				} else {
					console.log(`  ✅ Video already has faststart`);
				}
			}
		}

		// STEP 3: Mark job as completed
		await db.update(videoJob)
			.set({
				status: 'completed',
				progress: 100,
				resultUrl,
				thumbnailUrl,
				duration: Math.round(duration),
				completedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(videoJob.id, jobId));

		// STEP 4: Update milestone_media with final video URL (with retry for race condition)
		const updated = await updateMilestoneMedia(jobId, {
			url: resultUrl,
			thumbnailUrl: thumbnailUrl || null,
			duration: Math.round(duration)
		});

		if (updated) {
			console.log(`✅ Job ${jobId} completed successfully`);
		} else {
			console.log(`✅ Job ${jobId} completed (milestone_media will sync on next query)`);
		}

	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : 'Unknown error';
		const newRetryCount = (job.retryCount || 0) + 1;
		
		if (newRetryCount >= MAX_RETRIES) {
			// Move to dead-letter queue after max retries
			console.error(`💀 Job ${jobId} moved to dead-letter after ${newRetryCount} attempts: ${errorMsg}`);
			await db.update(videoJob)
				.set({
					status: 'dead-letter',
					error: `Max retries (${MAX_RETRIES}) exceeded. Last error: ${errorMsg}`,
					retryCount: newRetryCount,
					updatedAt: new Date()
				})
				.where(eq(videoJob.id, jobId));
		} else {
			// Mark as failed for retry
			console.error(`❌ Job ${jobId} failed (attempt ${newRetryCount}/${MAX_RETRIES}): ${errorMsg}`);
			await db.update(videoJob)
				.set({
					status: 'failed',
					error: errorMsg,
					retryCount: newRetryCount,
					updatedAt: new Date()
				})
				.where(eq(videoJob.id, jobId));
		}
	}
}

async function pollForJobs(): Promise<void> {
	if (isProcessing || shouldExit) return;

	try {
		// Get next pending or failed job (failed jobs will be retried)
		const [job] = await db.select()
			.from(videoJob)
			.where(sql`${videoJob.status} IN ('pending', 'failed')`)
			.orderBy(videoJob.createdAt)
			.limit(1);

		if (job) {
			isProcessing = true;
			await processJob(job);
			isProcessing = false;
		}
	} catch (err) {
		console.error('Error polling for jobs:', err);
		isProcessing = false;
	}
}

async function main(): Promise<void> {
	// Check ffmpeg availability
	const ffmpegAvailable = await isFFmpegAvailable();
	if (!ffmpegAvailable) {
		console.error('❌ ffmpeg not found. Please install ffmpeg to enable video processing.');
		console.error('   On macOS: brew install ffmpeg');
		console.error('   On Ubuntu: apt-get install ffmpeg');
		process.exit(1);
	}
	console.log('✅ ffmpeg available');

	// Check if video_job table exists (wait for migrations if needed)
	let tableReady = false;
	let retries = 0;
	const maxRetries = 30; // Wait up to 60 seconds for migrations
	
	while (!tableReady && retries < maxRetries) {
		try {
			// Try a simple query to check if table exists
			await db.select().from(videoJob).limit(1);
			tableReady = true;
		} catch (err) {
			if (retries === 0) {
				console.log('⏳ Waiting for database migrations...');
			}
			retries++;
			await new Promise(resolve => setTimeout(resolve, 2000));
		}
	}
	
	if (!tableReady) {
		console.error('❌ video_job table not found after waiting. Run: npm run db:push');
		process.exit(1);
	}
	console.log('✅ Database ready');

	// Reset any stale "processing" jobs from previous crashed runs
	try {
		await db.update(videoJob)
			.set({ status: 'pending', updatedAt: new Date() })
			.where(eq(videoJob.status, 'processing'));
	} catch {
		// Table might be empty, that's fine
	}
	
	console.log('🔄 Starting job polling loop...\n');

	// Main polling loop
	while (!shouldExit) {
		await pollForJobs();
		await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
	}

	console.log('👋 Worker shutdown complete');
	process.exit(0);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
