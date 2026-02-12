import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { unlink, rename, writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { db } from './db';
import { videoJob } from './db/schema';
import { eq } from 'drizzle-orm';

// Thumbnail size matching image.ts for consistent grid layout
const THUMBNAIL_SIZE = 600;

export interface VideoProcessingResult {
	success: boolean;
	outputPath?: string;
	thumbnailPath?: string;
	error?: string;
	duration?: number;
}

export interface VideoJobStatus {
	status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead-letter';
	progress?: number;
	resultUrl?: string;
	thumbnailUrl?: string;
	duration?: number;
	error?: string;
}

/**
 * Get the status of a video processing job from database
 */
export async function getVideoJobStatus(jobId: string): Promise<VideoJobStatus | undefined> {
	const [job] = await db.select().from(videoJob).where(eq(videoJob.id, jobId));
	if (!job) return undefined;
	
	return {
		status: job.status,
		progress: job.progress ?? undefined,
		resultUrl: job.resultUrl ?? undefined,
		thumbnailUrl: job.thumbnailUrl ?? undefined,
		duration: job.duration ?? undefined,
		error: job.error ?? undefined
	};
}

/**
 * Queue a video for background transcoding
 * Creates a job in the database - worker process will pick it up
 */
export async function queueVideoTranscode(
	inputPath: string, 
	jobId: string,
	mimeType: string,
	filename: string
): Promise<void> {
	await db.insert(videoJob).values({
		id: jobId,
		inputPath,
		mimeType,
		filename,
		status: 'pending',
		progress: 0,
		createdAt: new Date(),
		updatedAt: new Date()
	});
}

/**
 * Check if ffmpeg is available on the system
 */
export async function isFFmpegAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('ffmpeg', ['-version']);
		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
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

/**
 * Get video duration in seconds
 */
export async function getVideoDuration(inputPath: string): Promise<number> {
	return new Promise((resolve, reject) => {
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

		proc.on('error', (err) => reject(err));
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

/**
 * Check if a video file needs transcoding to web-compatible format
 */
export function needsTranscoding(mimeType: string, filename: string): boolean {
	const webCompatible = [
		'video/mp4',
		'video/webm'
	];
	
	// Check mime type
	if (webCompatible.includes(mimeType)) {
		return false;
	}
	
	// Check extension as fallback
	const ext = extname(filename).toLowerCase();
	const webCompatibleExts = ['.mp4', '.webm'];
	
	return !webCompatibleExts.includes(ext);
}

/**
 * Transcode video to web-compatible H.264 MP4 format
 */
export async function transcodeToWebFormat(inputPath: string): Promise<VideoProcessingResult> {
	if (!existsSync(inputPath)) {
		return { success: false, error: 'Input file does not exist' };
	}

	const dir = dirname(inputPath);
	const name = basename(inputPath, extname(inputPath));
	const outputPath = join(dir, `${name}_web.mp4`);
	const thumbnailPath = join(dir, `${name}_thumb.jpg`);

	try {
		// Check if ffmpeg is available
		if (!(await isFFmpegAvailable())) {
			// ffmpeg not available, just return the original file
			// Videos may not play in all browsers, but at least they're stored
			console.warn('ffmpeg not available, skipping video transcoding');
			return { 
				success: true, 
				outputPath: inputPath,
				error: 'ffmpeg not available - video not transcoded'
			};
		}

		// Get duration first
		const duration = await getVideoDuration(inputPath);

		// Transcode to H.264 MP4
		await new Promise<void>((resolve, reject) => {
			const proc = spawn('ffmpeg', [
				'-i', inputPath,
				'-c:v', 'libx264',
				'-preset', 'medium',
				'-crf', '23',
				'-c:a', 'aac',
				'-b:a', '128k',
				'-movflags', '+faststart',
				'-y',
				outputPath
			]);

			proc.on('error', (err) => reject(err));
			proc.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`ffmpeg exited with code ${code}`));
				}
			});
		});

		// Generate thumbnail (at 1 second or 10% into the video)
		// Center-cropped square matching image thumbnails
		// Note: ffmpeg creates baseline JPEG, we'll convert to progressive after
		const thumbnailTime = Math.min(1, duration * 0.1);
		await new Promise<void>((resolve, reject) => {
			const proc = spawn('ffmpeg', [
				'-i', outputPath,
				'-ss', thumbnailTime.toString(),
				'-vframes', '1',
				'-vf', `scale=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}:force_original_aspect_ratio=increase,crop=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}`,
				'-y',
				thumbnailPath
			]);

			proc.on('error', (err) => reject(err));
			proc.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					// Thumbnail generation failed, but transcoding succeeded
					resolve();
				}
			});
		});

		// Convert thumbnail to progressive JPEG using ImageMagick if available
		try {
			await makeProgressiveJpeg(thumbnailPath);
		} catch {
			// Ignore - baseline JPEG is acceptable fallback
		}

		// Delete original file and rename transcoded file
		await unlink(inputPath);
		const finalPath = inputPath.replace(extname(inputPath), '.mp4');
		await rename(outputPath, finalPath);

		return {
			success: true,
			outputPath: finalPath,
			thumbnailPath: existsSync(thumbnailPath) ? thumbnailPath : undefined,
			duration: Math.round(duration)
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Unknown error during transcoding'
		};
	}
}

/**
 * Generate a thumbnail for a video
 * Center-cropped square matching image thumbnails
 */
export async function generateThumbnail(inputPath: string, outputPath: string, timeOffset = 1): Promise<boolean> {
	if (!(await isFFmpegAvailable())) {
		return false;
	}

	const success = await new Promise<boolean>((resolve) => {
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
