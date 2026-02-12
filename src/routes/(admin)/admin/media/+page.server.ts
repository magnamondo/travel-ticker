import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { milestoneMedia, videoJob, milestone } from '$lib/server/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { readdir, unlink, stat } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || 'data';
const UPLOADS_DIR = DATA_DIR.startsWith('/')
	? join(DATA_DIR, 'uploads')
	: join(process.cwd(), DATA_DIR, 'uploads');
const CHUNKS_DIR = join(UPLOADS_DIR, 'chunks');

const PAGE_SIZE = 24; // Grid-friendly number

interface FileInfo {
	filename: string;
	path: string;
	size: number;
	modifiedAt: Date;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function getReferencedFiles(): Promise<Set<string>> {
	const referenced = new Set<string>();

	// Get all URLs from milestone_media
	const mediaRows = await db.select({
		url: milestoneMedia.url,
		thumbnailUrl: milestoneMedia.thumbnailUrl
	}).from(milestoneMedia);

	for (const row of mediaRows) {
		if (row.url?.startsWith('/api/uploads/')) {
			referenced.add(row.url.replace('/api/uploads/', ''));
		}
		if (row.thumbnailUrl?.startsWith('/api/uploads/')) {
			referenced.add(row.thumbnailUrl.replace('/api/uploads/', ''));
		}
	}

	// Get all URLs from video_job
	const jobRows = await db.select({
		inputPath: videoJob.inputPath,
		resultUrl: videoJob.resultUrl,
		thumbnailUrl: videoJob.thumbnailUrl
	}).from(videoJob);

	for (const row of jobRows) {
		if (row.inputPath) {
			referenced.add(basename(row.inputPath));
		}
		if (row.resultUrl?.startsWith('/api/uploads/')) {
			referenced.add(row.resultUrl.replace('/api/uploads/', ''));
		}
		if (row.thumbnailUrl?.startsWith('/api/uploads/')) {
			referenced.add(row.thumbnailUrl.replace('/api/uploads/', ''));
		}
	}

	return referenced;
}

async function getFilesOnDisk(): Promise<FileInfo[]> {
	const files: FileInfo[] = [];

	if (!existsSync(UPLOADS_DIR)) {
		return files;
	}

	const entries = await readdir(UPLOADS_DIR, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.isFile()) {
			const filePath = join(UPLOADS_DIR, entry.name);
			try {
				const stats = await stat(filePath);
				files.push({
					filename: entry.name,
					path: filePath,
					size: stats.size,
					modifiedAt: stats.mtime
				});
			} catch {
				// Skip files we can't stat
			}
		}
	}

	return files;
}

async function getChunksSize(): Promise<number> {
	let totalSize = 0;

	if (!existsSync(CHUNKS_DIR)) {
		return totalSize;
	}

	const sessionDirs = await readdir(CHUNKS_DIR, { withFileTypes: true });

	for (const sessionDir of sessionDirs) {
		if (sessionDir.isDirectory()) {
			const sessionPath = join(CHUNKS_DIR, sessionDir.name);
			try {
				const chunks = await readdir(sessionPath);
				for (const chunk of chunks) {
					const chunkPath = join(sessionPath, chunk);
					const stats = await stat(chunkPath);
					totalSize += stats.size;
				}
			} catch {
				// Skip directories we can't read
			}
		}
	}

	return totalSize;
}

export const load: PageServerLoad = async ({ url }) => {
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
	const filter = url.searchParams.get('filter') || 'all'; // all, images, videos, orphans
	const offset = (page - 1) * PAGE_SIZE;

	// Get all media from database with milestone info
	const allMedia = await db
		.select({
			id: milestoneMedia.id,
			milestoneId: milestoneMedia.milestoneId,
			type: milestoneMedia.type,
			url: milestoneMedia.url,
			thumbnailUrl: milestoneMedia.thumbnailUrl,
			caption: milestoneMedia.caption,
			duration: milestoneMedia.duration,
			createdAt: milestoneMedia.createdAt,
			milestoneTitle: milestone.title
		})
		.from(milestoneMedia)
		.leftJoin(milestone, eq(milestoneMedia.milestoneId, milestone.id))
		.orderBy(desc(milestoneMedia.createdAt));

	// Get files on disk and find orphans
	const filesOnDisk = await getFilesOnDisk();
	const referencedFiles = await getReferencedFiles();

	// Identify orphans
	const orphanedFiles = filesOnDisk
		.filter(f => !referencedFiles.has(f.filename))
		.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

	// Calculate storage stats
	const totalDiskSize = filesOnDisk.reduce((sum, f) => sum + f.size, 0);
	const orphanedSize = orphanedFiles.reduce((sum, f) => sum + f.size, 0);
	const chunksSize = await getChunksSize();

	// Filter media
	let filteredMedia = allMedia;
	if (filter === 'images') {
		filteredMedia = allMedia.filter(m => m.type === 'image');
	} else if (filter === 'videos') {
		filteredMedia = allMedia.filter(m => m.type === 'video');
	}

	// Apply pagination based on filter
	const isOrphanView = filter === 'orphans';
	const totalItems = isOrphanView ? orphanedFiles.length : filteredMedia.length;
	const totalPages = Math.ceil(totalItems / PAGE_SIZE);

	const paginatedMedia = isOrphanView ? [] : filteredMedia.slice(offset, offset + PAGE_SIZE);
	const paginatedOrphans = isOrphanView ? orphanedFiles.slice(offset, offset + PAGE_SIZE) : [];

	// Stats summary
	const stats = {
		totalFiles: filesOnDisk.length,
		totalSize: formatBytes(totalDiskSize),
		totalSizeBytes: totalDiskSize,
		images: allMedia.filter(m => m.type === 'image').length,
		videos: allMedia.filter(m => m.type === 'video').length,
		orphans: orphanedFiles.length,
		orphanedSize: formatBytes(orphanedSize),
		orphanedSizeBytes: orphanedSize,
		chunksSize: formatBytes(chunksSize),
		chunksSizeBytes: chunksSize
	};

	return {
		media: paginatedMedia,
		orphans: paginatedOrphans.map(f => ({
			...f,
			sizeFormatted: formatBytes(f.size)
		})),
		stats,
		filter,
		pagination: {
			page,
			pageSize: PAGE_SIZE,
			totalPages,
			total: totalItems
		}
	};
};

export const actions: Actions = {
	deleteMedia: async ({ request }) => {
		const formData = await request.formData();
		const mediaId = formData.get('mediaId') as string;

		if (!mediaId) {
			return fail(400, { error: 'Media ID required' });
		}

		// Get media record to find the file
		const [media] = await db.select().from(milestoneMedia).where(eq(milestoneMedia.id, mediaId));

		if (!media) {
			return fail(404, { error: 'Media not found' });
		}

		// Delete files from disk
		if (media.url?.startsWith('/api/uploads/')) {
			const filename = media.url.replace('/api/uploads/', '');
			const filePath = join(UPLOADS_DIR, filename);
			try {
				await unlink(filePath);
			} catch {
				// File may not exist
			}
		}

		if (media.thumbnailUrl?.startsWith('/api/uploads/')) {
			const filename = media.thumbnailUrl.replace('/api/uploads/', '');
			const filePath = join(UPLOADS_DIR, filename);
			try {
				await unlink(filePath);
			} catch {
				// File may not exist
			}
		}

		// Delete database record
		await db.delete(milestoneMedia).where(eq(milestoneMedia.id, mediaId));

		return { success: true, message: 'Media deleted' };
	},

	deleteOrphan: async ({ request }) => {
		const formData = await request.formData();
		const filename = formData.get('filename') as string;

		if (!filename) {
			return fail(400, { error: 'Filename required' });
		}

		// Security: only allow deleting from uploads directory
		const filePath = join(UPLOADS_DIR, basename(filename));

		// Verify file is actually in uploads dir (prevent path traversal)
		if (!filePath.startsWith(UPLOADS_DIR)) {
			return fail(400, { error: 'Invalid file path' });
		}

		try {
			await unlink(filePath);
			return { success: true, message: 'Orphaned file deleted' };
		} catch (err) {
			return fail(500, { error: 'Failed to delete file' });
		}
	},

	deleteAllOrphans: async () => {
		const filesOnDisk = await getFilesOnDisk();
		const referencedFiles = await getReferencedFiles();

		const orphanedFiles = filesOnDisk.filter(f => !referencedFiles.has(f.filename));

		let deleted = 0;
		let failed = 0;

		for (const file of orphanedFiles) {
			try {
				await unlink(file.path);
				deleted++;
			} catch {
				failed++;
			}
		}

		return {
			success: true,
			message: `Deleted ${deleted} orphaned files${failed > 0 ? `, ${failed} failed` : ''}`
		};
	}
};
