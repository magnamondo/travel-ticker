/**
 * Fix all MP4 videos that don't have faststart (moov atom at the beginning)
 * 
 * Usage: npx tsx scripts/fix-video-faststart.ts
 * 
 * This script:
 * 1. Scans all MP4 files in the uploads directory
 * 2. Checks if each file has faststart (moov before mdat)
 * 3. Remuxes files without faststart to add it (no quality loss)
 * 
 * Faststart is required for efficient video streaming - without it,
 * browsers must download the entire file before playback can begin.
 */

import { existsSync } from 'fs';
import { readdir, stat, unlink, rename } from 'fs/promises';
import { createReadStream } from 'fs';
import { spawn } from 'child_process';
import { join, extname } from 'path';

const DATA_DIR = process.env.DATA_DIR || 'data';
const UPLOADS_DIR = join(process.cwd(), DATA_DIR, 'uploads');

async function isFFmpegAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('ffmpeg', ['-version']);
		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}

/**
 * Check if an MP4 file has faststart (moov atom before mdat)
 * Reads first 4KB and checks atom order
 */
async function hasFaststart(filePath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		const stream = createReadStream(filePath, { start: 0, end: 4095 });
		
		stream.on('data', (chunk) => {
			chunks.push(chunk as Buffer);
		});
		
		stream.on('end', () => {
			try {
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
				resolve(false);
			}
		});
		
		stream.on('error', () => resolve(false));
	});
}

/**
 * Remux MP4 with faststart (moov at beginning) without re-encoding
 * This is fast since it only moves metadata around
 */
async function applyFaststart(inputPath: string): Promise<boolean> {
	const tempPath = inputPath.replace('.mp4', '_faststart_temp.mp4');
	
	const success = await new Promise<boolean>((resolve) => {
		const proc = spawn('ffmpeg', [
			'-i', inputPath,
			'-c', 'copy',           // No re-encoding, just remux
			'-movflags', '+faststart',
			'-y',
			tempPath
		]);

		proc.stderr.on('data', (data) => {
			// Uncomment for debugging: console.log(data.toString());
		});

		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});

	if (success) {
		// Delete original and rename
		await unlink(inputPath);
		await rename(tempPath, inputPath);
		return true;
	}

	// Cleanup temp file on failure
	try {
		if (existsSync(tempPath)) {
			await unlink(tempPath);
		}
	} catch {
		// Ignore cleanup errors
	}

	return false;
}

async function formatBytes(bytes: number): Promise<string> {
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
	if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

async function main() {
	console.log('🎬 Video Faststart Fix Script');
	console.log('============================\n');
	
	// Check ffmpeg
	if (!(await isFFmpegAvailable())) {
		console.error('❌ ffmpeg is not available. Please install it first.');
		process.exit(1);
	}
	
	// Check uploads directory
	if (!existsSync(UPLOADS_DIR)) {
		console.error(`❌ Uploads directory not found: ${UPLOADS_DIR}`);
		process.exit(1);
	}
	
	console.log(`📁 Scanning: ${UPLOADS_DIR}\n`);
	
	// Find all MP4 files
	const files = await readdir(UPLOADS_DIR);
	const mp4Files = files.filter(f => extname(f).toLowerCase() === '.mp4');
	
	console.log(`Found ${mp4Files.length} MP4 files\n`);
	
	let fixed = 0;
	let skipped = 0;
	let failed = 0;
	let totalBytesProcessed = 0;
	
	for (const file of mp4Files) {
		const filePath = join(UPLOADS_DIR, file);
		const stats = await stat(filePath);
		const sizeStr = await formatBytes(stats.size);
		
		process.stdout.write(`  ${file} (${sizeStr})`);
		
		const hasFS = await hasFaststart(filePath);
		
		if (hasFS) {
			console.log(' ✅ Already has faststart');
			skipped++;
		} else {
			process.stdout.write(' ⚡ Fixing...');
			const startTime = Date.now();
			const success = await applyFaststart(filePath);
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			
			if (success) {
				console.log(` ✅ Fixed in ${elapsed}s`);
				fixed++;
				totalBytesProcessed += stats.size;
			} else {
				console.log(' ❌ Failed');
				failed++;
			}
		}
	}
	
	console.log('\n============================');
	console.log('Summary:');
	console.log(`  ✅ Fixed: ${fixed}`);
	console.log(`  ⏭️  Skipped (already OK): ${skipped}`);
	console.log(`  ❌ Failed: ${failed}`);
	if (totalBytesProcessed > 0) {
		console.log(`  📊 Total processed: ${await formatBytes(totalBytesProcessed)}`);
	}
	
	process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
