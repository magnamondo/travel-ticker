import { extname } from 'path';
import { db } from './db';
import { videoJob } from './db/schema';
import { eq } from 'drizzle-orm';

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
