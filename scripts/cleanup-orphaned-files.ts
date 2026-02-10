/**
 * Cleanup script to remove orphaned files from uploads directory
 * 
 * This script finds files in data/uploads that are not referenced by any:
 * - milestone_media record (url or thumbnailUrl)
 * - video_job record (inputPath, resultUrl, thumbnailUrl)
 * 
 * Also cleans up orphaned chunk directories from incomplete uploads.
 * 
 * Usage: npx tsx scripts/cleanup-orphaned-files.ts [--dry-run]
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readdir, rm, stat } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');
const DATABASE_URL = process.env.DATABASE_URL || 'data/db/database.db';
const DATA_DIR = process.env.DATA_DIR || 'data';
// Handle both absolute and relative DATA_DIR paths
const UPLOADS_DIR = DATA_DIR.startsWith('/') 
	? join(DATA_DIR, 'uploads')
	: join(process.cwd(), DATA_DIR, 'uploads');
const CHUNKS_DIR = join(UPLOADS_DIR, 'chunks');

// Simple SQL queries to avoid importing schema
const sqlite = new Database(DATABASE_URL);
const db = drizzle(sqlite);

interface FileInfo {
	path: string;
	size: number;
}

async function getReferencedFiles(): Promise<Set<string>> {
	const referenced = new Set<string>();

	// Get all URLs from milestone_media
	const mediaRows = sqlite.prepare(`
		SELECT url, thumbnail_url FROM milestone_media
	`).all() as { url: string; thumbnail_url: string | null }[];

	for (const row of mediaRows) {
		if (row.url?.startsWith('/api/uploads/')) {
			referenced.add(row.url.replace('/api/uploads/', ''));
		}
		if (row.thumbnail_url?.startsWith('/api/uploads/')) {
			referenced.add(row.thumbnail_url.replace('/api/uploads/', ''));
		}
	}

	// Get all URLs from video_job
	const jobRows = sqlite.prepare(`
		SELECT input_path, result_url, thumbnail_url FROM video_job
	`).all() as { input_path: string; result_url: string | null; thumbnail_url: string | null }[];

	for (const row of jobRows) {
		// input_path is a full filesystem path
		if (row.input_path) {
			const filename = basename(row.input_path);
			referenced.add(filename);
		}
		if (row.result_url?.startsWith('/api/uploads/')) {
			referenced.add(row.result_url.replace('/api/uploads/', ''));
		}
		if (row.thumbnail_url?.startsWith('/api/uploads/')) {
			referenced.add(row.thumbnail_url.replace('/api/uploads/', ''));
		}
	}

	return referenced;
}

async function getActiveUploadSessions(): Promise<Set<string>> {
	const active = new Set<string>();

	// Get upload sessions that are still in progress (not completed/failed and not expired)
	const sessions = sqlite.prepare(`
		SELECT id FROM upload_session 
		WHERE status IN ('pending', 'uploading') 
		AND expires_at > ?
	`).all(Date.now()) as { id: string }[];

	for (const session of sessions) {
		active.add(session.id);
	}

	return active;
}

async function getFilesInDirectory(dir: string): Promise<FileInfo[]> {
	const files: FileInfo[] = [];
	
	if (!existsSync(dir)) {
		return files;
	}

	const entries = await readdir(dir, { withFileTypes: true });
	
	for (const entry of entries) {
		if (entry.isFile()) {
			const filePath = join(dir, entry.name);
			const stats = await stat(filePath);
			files.push({ path: filePath, size: stats.size });
		}
	}

	return files;
}

async function getChunkDirectories(): Promise<string[]> {
	const dirs: string[] = [];
	
	if (!existsSync(CHUNKS_DIR)) {
		return dirs;
	}

	const entries = await readdir(CHUNKS_DIR, { withFileTypes: true });
	
	for (const entry of entries) {
		if (entry.isDirectory()) {
			dirs.push(entry.name);
		}
	}

	return dirs;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
	console.log('🧹 Orphaned Files Cleanup Script');
	console.log(`📂 Uploads directory: ${UPLOADS_DIR}`);
	console.log(`📊 Database: ${DATABASE_URL}`);
	if (DRY_RUN) {
		console.log('🔍 DRY RUN - no files will be deleted\n');
	} else {
		console.log('⚠️  LIVE RUN - files will be deleted\n');
	}

	// Get referenced files from database
	console.log('Scanning database for referenced files...');
	const referencedFiles = await getReferencedFiles();
	console.log(`Found ${referencedFiles.size} referenced files in database\n`);

	// Get active upload sessions
	const activeSessions = await getActiveUploadSessions();
	console.log(`Found ${activeSessions.size} active upload sessions\n`);

	// Get files in uploads directory
	console.log('Scanning uploads directory...');
	const uploadFiles = await getFilesInDirectory(UPLOADS_DIR);
	console.log(`Found ${uploadFiles.length} files in uploads directory\n`);

	// Find orphaned files
	const orphanedFiles: FileInfo[] = [];
	for (const file of uploadFiles) {
		const filename = basename(file.path);
		// Skip the chunks directory itself
		if (filename === 'chunks') continue;
		
		if (!referencedFiles.has(filename)) {
			orphanedFiles.push(file);
		}
	}

	// Get orphaned chunk directories
	const chunkDirs = await getChunkDirectories();
	const orphanedChunkDirs: string[] = [];
	for (const dir of chunkDirs) {
		if (!activeSessions.has(dir)) {
			orphanedChunkDirs.push(dir);
		}
	}

	// Report orphaned files
	let totalOrphanedSize = 0;
	if (orphanedFiles.length > 0) {
		console.log(`Found ${orphanedFiles.length} orphaned files:`);
		for (const file of orphanedFiles) {
			totalOrphanedSize += file.size;
			console.log(`  - ${basename(file.path)} (${formatBytes(file.size)})`);
		}
		console.log(`Total orphaned file size: ${formatBytes(totalOrphanedSize)}\n`);
	} else {
		console.log('No orphaned files found.\n');
	}

	// Report orphaned chunk directories
	if (orphanedChunkDirs.length > 0) {
		console.log(`Found ${orphanedChunkDirs.length} orphaned chunk directories:`);
		for (const dir of orphanedChunkDirs) {
			const chunkPath = join(CHUNKS_DIR, dir);
			const chunkFiles = await getFilesInDirectory(chunkPath);
			const chunkSize = chunkFiles.reduce((sum, f) => sum + f.size, 0);
			totalOrphanedSize += chunkSize;
			console.log(`  - ${dir}/ (${chunkFiles.length} chunks, ${formatBytes(chunkSize)})`);
		}
		console.log();
	} else {
		console.log('No orphaned chunk directories found.\n');
	}

	if (orphanedFiles.length === 0 && orphanedChunkDirs.length === 0) {
		console.log('✅ No cleanup needed!');
		process.exit(0);
	}

	console.log(`Total space to reclaim: ${formatBytes(totalOrphanedSize)}\n`);

	// Delete orphaned files
	if (!DRY_RUN) {
		console.log('Deleting orphaned files...');
		
		for (const file of orphanedFiles) {
			try {
				await rm(file.path);
				console.log(`  ✅ Deleted ${basename(file.path)}`);
			} catch (err) {
				console.log(`  ❌ Failed to delete ${basename(file.path)}: ${err}`);
			}
		}

		for (const dir of orphanedChunkDirs) {
			const chunkPath = join(CHUNKS_DIR, dir);
			try {
				await rm(chunkPath, { recursive: true });
				console.log(`  ✅ Deleted chunks/${dir}/`);
			} catch (err) {
				console.log(`  ❌ Failed to delete chunks/${dir}/: ${err}`);
			}
		}

		console.log('\n✅ Cleanup complete!');
	} else {
		console.log('Run without --dry-run to delete these files.');
	}

	sqlite.close();
}

main().catch(console.error);
