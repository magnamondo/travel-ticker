import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { unlink, rename, stat } from 'fs/promises';
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
 * Check if ImageMagick (convert) is available on the system
 */
export async function isImageMagickAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('convert', ['-version']);
		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}

/**
 * Check if ffmpeg is available (can also convert HEIC)
 */
export async function isFFmpegAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('ffmpeg', ['-version']);
		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}

/**
 * Convert HEIC image to JPEG using ImageMagick or ffmpeg
 * Returns the path to the converted file
 */
export async function convertHeicToJpeg(inputPath: string): Promise<ImageConversionResult> {
	if (!existsSync(inputPath)) {
		return { success: false, error: 'Input file not found' };
	}

	const dir = dirname(inputPath);
	const base = basename(inputPath, extname(inputPath));
	const outputPath = join(dir, `${base}.jpg`);

	// Try ImageMagick first (better quality), then ffmpeg as fallback
	const imageMagickAvailable = await isImageMagickAvailable();
	const ffmpegAvailable = await isFFmpegAvailable();

	if (!imageMagickAvailable && !ffmpegAvailable) {
		return { 
			success: false, 
			error: 'Neither ImageMagick nor ffmpeg available for HEIC conversion' 
		};
	}

	try {
		if (imageMagickAvailable) {
			await convertWithImageMagick(inputPath, outputPath);
		} else {
			await convertWithFFmpeg(inputPath, outputPath);
		}

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
 * Convert using ImageMagick's convert command
 */
function convertWithImageMagick(inputPath: string, outputPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn('convert', [
			inputPath,
			'-auto-orient',  // Respect EXIF orientation
			'-interlace', 'Plane',  // Progressive JPEG
			'-quality', '90',
			outputPath
		]);

		let stderr = '';
		proc.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ImageMagick convert failed: ${stderr}`));
			}
		});
	});
}

/**
 * Convert using ffmpeg as fallback
 */
function convertWithFFmpeg(inputPath: string, outputPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn('ffmpeg', [
			'-y',  // Overwrite output
			'-i', inputPath,
			'-q:v', '2',  // High quality JPEG
			outputPath
		]);

		let stderr = '';
		proc.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ffmpeg conversion failed: ${stderr}`));
			}
		});
	});
}

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
 * Check if a file is an image that can have a thumbnail generated
 */
export function isImageFile(mimeType: string): boolean {
	return IMAGE_MIME_TYPES.includes(mimeType.toLowerCase());
}

/**
 * Generate a thumbnail for an image file using ImageMagick or ffmpeg
 * Creates a 600x600 thumbnail (center cropped) for the grid layout
 */
export async function generateImageThumbnail(
	inputPath: string,
	outputPath?: string
): Promise<ImageConversionResult> {
	if (!existsSync(inputPath)) {
		return { success: false, error: 'Input file not found' };
	}

	const imageMagickAvailable = await isImageMagickAvailable();
	const ffmpegAvailable = await isFFmpegAvailable();

	if (!imageMagickAvailable && !ffmpegAvailable) {
		return { success: false, error: 'Neither ImageMagick nor ffmpeg available for thumbnail generation' };
	}

	const dir = dirname(inputPath);
	const base = basename(inputPath, extname(inputPath));
	const thumbPath = outputPath || join(dir, `${base}_thumb.jpg`);

	try {
		if (imageMagickAvailable) {
			await generateThumbnailWithImageMagick(inputPath, thumbPath);
		} else {
			await generateThumbnailWithFFmpeg(inputPath, thumbPath);
		}

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
 * Generate thumbnail using ImageMagick
 */
function generateThumbnailWithImageMagick(inputPath: string, outputPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		// Use ImageMagick to create a thumbnail
		// -thumbnail respects EXIF orientation and strips metadata for smaller files
		// Size^ means fill the box, then we crop to exact size
		// -interlace Plane creates progressive JPEG for better perceived loading
		const proc = spawn('convert', [
			inputPath,
			'-auto-orient',
			'-thumbnail', `${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}^`,
			'-gravity', 'center',
			'-extent', `${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}`,
			'-interlace', 'Plane',
			'-quality', '85',
			outputPath
		]);

		let stderr = '';
		proc.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ImageMagick thumbnail failed: ${stderr}`));
			}
		});
	});
}

/**
 * Generate thumbnail using ffmpeg as fallback
 * Note: ffmpeg JPEG output doesn't support progressive encoding natively,
 * but ImageMagick (primary method) does. This is acceptable as a fallback.
 */
function generateThumbnailWithFFmpeg(inputPath: string, outputPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		// Use ffmpeg to create a center-cropped thumbnail
		const proc = spawn('ffmpeg', [
			'-y',
			'-i', inputPath,
			'-vf', `scale=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}:force_original_aspect_ratio=increase,crop=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}`,
			'-frames:v', '1',
			'-q:v', '2',
			outputPath
		]);

		let stderr = '';
		proc.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ffmpeg thumbnail failed: ${stderr}`));
			}
		});
	});
}

/**
 * Get image dimensions using ImageMagick or ffprobe
 */
export async function getImageDimensions(inputPath: string): Promise<ImageDimensions | null> {
	if (!existsSync(inputPath)) {
		return null;
	}

	const imageMagickAvailable = await isImageMagickAvailable();
	const ffmpegAvailable = await isFFmpegAvailable();

	if (imageMagickAvailable) {
		return getImageDimensionsWithIdentify(inputPath);
	} else if (ffmpegAvailable) {
		return getImageDimensionsWithFFprobe(inputPath);
	}

	return null;
}

function getImageDimensionsWithIdentify(inputPath: string): Promise<ImageDimensions | null> {
	return new Promise((resolve) => {
		const proc = spawn('identify', ['-format', '%wx%h', inputPath]);

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

function getImageDimensionsWithFFprobe(inputPath: string): Promise<ImageDimensions | null> {
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

/**
 * Check if an image exceeds maximum dimensions and needs resizing
 * Uses a simple "longest side" approach - max 2048px on either dimension
 */
function needsResize(dimensions: ImageDimensions): boolean {
	return dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION;
}

/**
 * Resize an image if it exceeds maximum dimensions
 * Deletes the original and replaces it with the resized version
 * Returns the path to the (possibly unchanged) image
 */
export async function resizeImageIfNeeded(inputPath: string): Promise<ImageConversionResult> {
	if (!existsSync(inputPath)) {
		return { success: false, error: 'Input file not found' };
	}

	const dimensions = await getImageDimensions(inputPath);
	if (!dimensions) {
		// Can't determine dimensions, skip resize
		return { success: true, outputPath: inputPath };
	}

	if (!needsResize(dimensions)) {
		// No resize needed
		return { success: true, outputPath: inputPath };
	}

	const imageMagickAvailable = await isImageMagickAvailable();
	const ffmpegAvailable = await isFFmpegAvailable();

	if (!imageMagickAvailable && !ffmpegAvailable) {
		return { success: false, error: 'Neither ImageMagick nor ffmpeg available for resizing' };
	}

	const dir = dirname(inputPath);
	const ext = extname(inputPath);
	const base = basename(inputPath, ext);
	const tempPath = join(dir, `${base}_resized${ext}`);

	try {
		if (imageMagickAvailable) {
			await resizeWithImageMagick(inputPath, tempPath, MAX_IMAGE_DIMENSION);
		} else {
			await resizeWithFFmpeg(inputPath, tempPath, MAX_IMAGE_DIMENSION);
		}

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

function resizeWithImageMagick(inputPath: string, outputPath: string, maxDimension: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn('convert', [
			inputPath,
			'-auto-orient',
			'-resize', `${maxDimension}x${maxDimension}>`,  // Only shrink larger images, maintain aspect ratio
			'-interlace', 'Plane',  // Progressive JPEG
			'-quality', '90',
			outputPath
		]);

		let stderr = '';
		proc.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ImageMagick resize failed: ${stderr}`));
			}
		});
	});
}

function resizeWithFFmpeg(inputPath: string, outputPath: string, maxDimension: number): Promise<void> {
	return new Promise((resolve, reject) => {
		// Scale to fit within maxDimension x maxDimension while maintaining aspect ratio
		const proc = spawn('ffmpeg', [
			'-y',
			'-i', inputPath,
			'-vf', `scale='if(gt(iw,ih),min(${maxDimension},iw),-2)':'if(gt(ih,iw),min(${maxDimension},ih),-2)'`,
			'-q:v', '2',
			outputPath
		]);

		let stderr = '';
		proc.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ffmpeg resize failed: ${stderr}`));
			}
		});
	});
}
