import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { unlink, rename } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';

// Maximum image dimension (longest side)
// 2048px is the industry standard for photo-sharing platforms:
// - Covers Retina displays (2x of typical 1024px elements)
// - Good balance between quality and file size
// - Used by platforms like Facebook, Flickr, etc.
const MAX_IMAGE_DIMENSION = 2048;

// Thumbnail size for the grid layout
// 600px covers the featured image (2x2 in 3-column grid) on most screens
// and provides good quality for retina displays
const THUMBNAIL_SIZE = 600;

export interface ImageDimensions {
	width: number;
	height: number;
}

export interface ImageConversionResult {
	success: boolean;
	outputPath?: string;
	error?: string;
	mimeType?: string;
	filename?: string;
}

// HEIC/HEIF MIME types that should be converted
const HEIC_MIME_TYPES = [
	'image/heic',
	'image/heif',
	'image/heic-sequence',
	'image/heif-sequence'
];

// HEIC file extensions
const HEIC_EXTENSIONS = ['.heic', '.heif'];

// Image MIME types that support thumbnail generation
const IMAGE_MIME_TYPES = [
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/heic',
	'image/heif'
];

/**
 * Check if a file is a HEIC/HEIF image that needs conversion
 */
export function isHeicFile(mimeType: string, filename: string): boolean {
	const ext = extname(filename).toLowerCase();
	return (
		HEIC_MIME_TYPES.includes(mimeType.toLowerCase()) ||
		HEIC_EXTENSIONS.includes(ext)
	);
}

/**
 * Check if a file is an image that can have a thumbnail generated
 */
export function isImageFile(mimeType: string): boolean {
	return IMAGE_MIME_TYPES.includes(mimeType.toLowerCase());
}

/**
 * Helper to run ImageMagick command and return a promise
 */
function runMagick(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn('magick', args);

		let stderr = '';
		proc.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ImageMagick failed: ${stderr}`));
			}
		});
	});
}

/**
 * Convert HEIC image to JPEG using ImageMagick
 * Returns the path to the converted file
 */
export async function convertHeicToJpeg(inputPath: string): Promise<ImageConversionResult> {
	if (!existsSync(inputPath)) {
		return { success: false, error: 'Input file not found' };
	}

	const dir = dirname(inputPath);
	const base = basename(inputPath, extname(inputPath));
	const outputPath = join(dir, `${base}.jpg`);

	try {
		await runMagick([
			inputPath,
			'-auto-orient',
			'-strip',
			'-interlace', 'Plane',
			'-quality', '90',
			outputPath
		]);

		// Remove original HEIC file
		try {
			await unlink(inputPath);
		} catch {
			// Ignore if we can't delete original
		}

		return {
			success: true,
			outputPath,
			mimeType: 'image/jpeg',
			filename: `${base}.jpg`
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Conversion failed'
		};
	}
}

/**
 * Generate a thumbnail for an image file using ImageMagick
 * Creates a 600x600 thumbnail (center cropped) for the grid layout
 */
export async function generateImageThumbnail(
	inputPath: string,
	outputPath?: string
): Promise<ImageConversionResult> {
	if (!existsSync(inputPath)) {
		return { success: false, error: 'Input file not found' };
	}

	const dir = dirname(inputPath);
	const base = basename(inputPath, extname(inputPath));
	const thumbPath = outputPath || join(dir, `${base}_thumb.jpg`);

	try {
		await runMagick([
			inputPath,
			'-auto-orient',
			'-strip',
			'-thumbnail', `${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}^`,
			'-gravity', 'center',
			'-extent', `${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}`,
			'-interlace', 'Plane',
			'-quality', '85',
			thumbPath
		]);

		return {
			success: true,
			outputPath: thumbPath,
			mimeType: 'image/jpeg',
			filename: `${base}_thumb.jpg`
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Thumbnail generation failed'
		};
	}
}

/**
 * Get image dimensions using ImageMagick identify
 */
export async function getImageDimensions(inputPath: string): Promise<ImageDimensions | null> {
	if (!existsSync(inputPath)) {
		return null;
	}

	return new Promise((resolve) => {
		const proc = spawn('magick', ['identify', '-format', '%wx%h', inputPath]);

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

/**
 * Check if an image exceeds maximum dimensions and needs resizing
 */
function needsResize(dimensions: ImageDimensions): boolean {
	return dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION;
}

/**
 * Strip all metadata from an image file (EXIF, GPS, etc.) for privacy
 * Replaces the original file with the stripped version
 */
export async function stripImageMetadata(inputPath: string): Promise<ImageConversionResult> {
	if (!existsSync(inputPath)) {
		return { success: false, error: 'Input file not found' };
	}

	const dir = dirname(inputPath);
	const ext = extname(inputPath);
	const base = basename(inputPath, ext);
	const tempPath = join(dir, `${base}_stripped${ext}`);

	try {
		await runMagick([
			inputPath,
			'-auto-orient',
			'-strip',
			'-interlace', 'Plane',
			'-quality', '90',
			tempPath
		]);

		// Delete original and rename stripped file to take its place
		await unlink(inputPath);
		await rename(tempPath, inputPath);

		return {
			success: true,
			outputPath: inputPath,
			mimeType: getMimeTypeFromExtension(ext)
		};
	} catch (err) {
		// Clean up temp file if it exists
		try {
			if (existsSync(tempPath)) {
				await unlink(tempPath);
			}
		} catch {
			// Ignore cleanup errors
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Metadata stripping failed'
		};
	}
}

/**
 * Resize an image if it exceeds maximum dimensions
 * Also strips all metadata for privacy
 * Deletes the original and replaces it with the processed version
 */
export async function resizeImageIfNeeded(inputPath: string): Promise<ImageConversionResult> {
	if (!existsSync(inputPath)) {
		return { success: false, error: 'Input file not found' };
	}

	const dimensions = await getImageDimensions(inputPath);
	if (!dimensions) {
		// Can't determine dimensions, but still strip metadata for privacy
		return stripImageMetadata(inputPath);
	}

	if (!needsResize(dimensions)) {
		// No resize needed, but still strip metadata for privacy
		return stripImageMetadata(inputPath);
	}

	const dir = dirname(inputPath);
	const ext = extname(inputPath);
	const base = basename(inputPath, ext);
	const tempPath = join(dir, `${base}_resized${ext}`);

	try {
		await runMagick([
			inputPath,
			'-auto-orient',
			'-strip',
			'-resize', `${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}>`,
			'-interlace', 'Plane',
			'-quality', '90',
			tempPath
		]);

		// Delete original and rename resized file to take its place
		await unlink(inputPath);
		await rename(tempPath, inputPath);

		console.log(`Resized image from ${dimensions.width}x${dimensions.height} to max ${MAX_IMAGE_DIMENSION}px`);

		return {
			success: true,
			outputPath: inputPath,
			mimeType: getMimeTypeFromExtension(ext)
		};
	} catch (err) {
		// Clean up temp file if it exists
		try {
			if (existsSync(tempPath)) {
				await unlink(tempPath);
			}
		} catch {
			// Ignore cleanup errors
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Resize failed'
		};
	}
}

function getMimeTypeFromExtension(ext: string): string {
	const mimeTypes: Record<string, string> = {
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.png': 'image/png',
		'.gif': 'image/gif',
		'.webp': 'image/webp'
	};
	return mimeTypes[ext.toLowerCase()] || 'image/jpeg';
}
