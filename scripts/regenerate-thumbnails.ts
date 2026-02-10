/**
 * Regenerate all thumbnails at the current THUMBNAIL_SIZE (600px)
 *
 * Usage: npx tsx scripts/regenerate-thumbnails.ts
 *
 * This script:
 * 1. Scans the database for all media with thumbnail URLs
 * 2. Regenerates each thumbnail from the source file
 * 3. Overwrites the existing thumbnail in place
 */

import { db } from '../src/lib/server/db';
import { milestoneMedia, videoJob } from '../src/lib/server/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || 'data';
const UPLOADS_DIR = join(process.cwd(), DATA_DIR, 'uploads');
const THUMBNAIL_SIZE = 600;

function urlToPath(url: string): string {
	const filename = url.replace('/api/uploads/', '');
	return join(UPLOADS_DIR, filename);
}

async function isImageMagickAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('convert', ['-version']);
		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}

async function isFFmpegAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('ffmpeg', ['-version']);
		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}

async function regenerateImageThumbnail(sourcePath: string, thumbPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('convert', [
			sourcePath,
			'-auto-orient',
			'-thumbnail', `${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}^`,
			'-gravity', 'center',
			'-extent', `${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}`,
			'-interlace', 'Plane',
			'-quality', '85',
			thumbPath
		]);

		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}

async function regenerateVideoThumbnail(sourcePath: string, thumbPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('ffmpeg', [
			'-y',
			'-i', sourcePath,
			'-ss', '1',
			'-vframes', '1',
			'-vf', `scale=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}:force_original_aspect_ratio=increase,crop=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}`,
			thumbPath
		]);

		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}

async function makeProgressiveJpeg(path: string): Promise<void> {
	return new Promise((resolve) => {
		const proc = spawn('convert', [path, '-interlace', 'Plane', path]);
		proc.on('error', () => resolve());
		proc.on('close', () => resolve());
	});
}

async function main() {
	console.log('Checking dependencies...');

	const hasImageMagick = await isImageMagickAvailable();
	const hasFFmpeg = await isFFmpegAvailable();

	console.log(`  ImageMagick: ${hasImageMagick ? 'available' : 'NOT FOUND'}`);
	console.log(`  ffmpeg: ${hasFFmpeg ? 'available' : 'NOT FOUND'}`);

	if (!hasImageMagick && !hasFFmpeg) {
		console.error('Error: Neither ImageMagick nor ffmpeg is available');
		process.exit(1);
	}

	console.log(`\nFetching media from database...`);

	const allMedia = await db
		.select()
		.from(milestoneMedia)
		.where(isNotNull(milestoneMedia.thumbnailUrl));

	console.log(`Found ${allMedia.length} media items with thumbnails\n`);

	let successCount = 0;
	let skipCount = 0;
	let errorCount = 0;

	for (const media of allMedia) {
		const thumbUrl = media.thumbnailUrl!;
		const thumbPath = urlToPath(thumbUrl);

		// Determine source file path
		const sourceUrl = media.url;
		const sourcePath = urlToPath(sourceUrl);

		if (!existsSync(sourcePath)) {
			console.log(`  SKIP: Source file not found: ${sourceUrl}`);
			skipCount++;
			continue;
		}

		let success = false;

		if (media.type === 'image') {
			if (!hasImageMagick) {
				console.log(`  SKIP: ImageMagick required for image: ${sourceUrl}`);
				skipCount++;
				continue;
			}
			console.log(`  Processing image: ${sourceUrl}`);
			success = await regenerateImageThumbnail(sourcePath, thumbPath);
		} else if (media.type === 'video') {
			if (!hasFFmpeg) {
				console.log(`  SKIP: ffmpeg required for video: ${sourceUrl}`);
				skipCount++;
				continue;
			}
			console.log(`  Processing video: ${sourceUrl}`);
			success = await regenerateVideoThumbnail(sourcePath, thumbPath);
			if (success && hasImageMagick) {
				await makeProgressiveJpeg(thumbPath);
			}
		}

		if (success) {
			console.log(`    ✓ Regenerated: ${thumbUrl}`);
			successCount++;
		} else {
			console.log(`    ✗ Failed: ${thumbUrl}`);
			errorCount++;
		}
	}

	console.log(`\n--- Summary ---`);
	console.log(`  Success: ${successCount}`);
	console.log(`  Skipped: ${skipCount}`);
	console.log(`  Errors: ${errorCount}`);
	console.log(`  Total: ${allMedia.length}`);

	process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
