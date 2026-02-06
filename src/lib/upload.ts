// Chunked Upload Utilities
// Provides robust file uploading with resumability, progress tracking, and error recovery

export interface UploadSession {
	sessionId: string;
	chunkSize: number;
	totalChunks: number;
	expiresAt: string;
}

export interface UploadProgress {
	uploadedChunks: number[];
	progress: number;
	bytesUploaded: number;
	totalBytes: number;
	speed: number; // bytes per second
	eta: number; // seconds remaining
}

export interface UploadResult {
	success: boolean;
	url: string;
	filename: string;
	fileSize: number;
	mimeType: string;
	checksum: string;
	thumbnailUrl?: string;
	duration?: number;
	videoProcessingJobId?: string; // For polling video transcoding status
}

export interface ChunkUploadResult {
	success: boolean;
	chunkIndex: number;
	uploadedChunks: number[];
	progress: number;
	isComplete: boolean;
	alreadyUploaded?: boolean;
}

const STORAGE_KEY_PREFIX = 'upload_session_';

/**
 * Compute MD5 checksum of a buffer
 */
async function computeChecksum(data: ArrayBuffer): Promise<string> {
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

/**
 * Split a file into chunks
 */
function* chunkFile(file: File, chunkSize: number): Generator<{ index: number; blob: Blob; start: number; end: number }> {
	let index = 0;
	let start = 0;
	while (start < file.size) {
		const end = Math.min(start + chunkSize, file.size);
		yield {
			index,
			blob: file.slice(start, end),
			start,
			end
		};
		index++;
		start = end;
	}
}

/**
 * Initialize an upload session
 */
export async function initializeUpload(
	file: File,
	milestoneId?: string,
	chunkSize: number = 256 * 1024
): Promise<UploadSession> {
	// Check for existing session in localStorage
	const existingSessionId = localStorage.getItem(`${STORAGE_KEY_PREFIX}${file.name}_${file.size}`);
	
	if (existingSessionId) {
		try {
			const response = await fetch(`/api/upload?sessionId=${existingSessionId}`);
			if (response.ok) {
				const session = await response.json();
				if (session.status !== 'completed') {
					console.log('Resuming existing upload session:', existingSessionId);
					return {
						sessionId: session.sessionId,
						chunkSize: session.chunkSize,
						totalChunks: session.totalChunks,
						expiresAt: session.expiresAt
					};
				}
			}
		} catch {
			// Session expired or invalid, create new one
		}
	}

	const response = await fetch('/api/upload', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			filename: file.name,
			fileSize: file.size,
			mimeType: file.type || 'application/octet-stream',
			milestoneId,
			chunkSize
		})
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(error.message || 'Failed to initialize upload');
	}

	const session = await response.json();
	
	// Store session ID for resumability
	localStorage.setItem(`${STORAGE_KEY_PREFIX}${file.name}_${file.size}`, session.sessionId);
	
	return session;
}

/**
 * Get the status of an upload session (for resuming)
 */
export async function getUploadStatus(sessionId: string): Promise<{
	uploadedChunks: number[];
	status: string;
	totalChunks: number;
	filePath?: string;
} | null> {
	const response = await fetch(`/api/upload?sessionId=${sessionId}`);
	if (!response.ok) {
		if (response.status === 404 || response.status === 410) {
			return null;
		}
		throw new Error('Failed to get upload status');
	}
	return response.json();
}

/**
 * Upload a single chunk with retry logic
 */
async function uploadChunkWithRetry(
	sessionId: string,
	chunkIndex: number,
	chunkBlob: Blob,
	maxRetries: number = 3,
	retryDelay: number = 1000,
	signal?: AbortSignal
): Promise<ChunkUploadResult> {
	let lastError: Error | null = null;
	
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			if (signal?.aborted) {
				throw new Error('Upload cancelled');
			}

			const formData = new FormData();
			formData.append('sessionId', sessionId);
			formData.append('chunkIndex', chunkIndex.toString());
			formData.append('chunk', chunkBlob);
			
			// Compute checksum for data integrity verification
			const arrayBuffer = await chunkBlob.arrayBuffer();
			const checksum = await computeChecksum(arrayBuffer);
			formData.append('checksum', checksum);

			const response = await fetch('/api/upload/chunk', {
				method: 'POST',
				body: formData,
				signal
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.message || `Chunk ${chunkIndex} upload failed`);
			}

			return await response.json();
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			
			if (signal?.aborted) {
				throw lastError;
			}

			if (attempt < maxRetries - 1) {
				// Exponential backoff
				const delay = retryDelay * Math.pow(2, attempt);
				console.log(`Chunk ${chunkIndex} failed, retrying in ${delay}ms...`, lastError.message);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	throw lastError || new Error(`Chunk ${chunkIndex} upload failed after ${maxRetries} attempts`);
}

/**
 * Complete an upload session (assemble chunks)
 */
export async function completeUpload(sessionId: string, fileChecksum?: string): Promise<UploadResult> {
	const response = await fetch('/api/upload/chunk', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sessionId,
			fileChecksum
		})
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(error.message || 'Failed to complete upload');
	}

	return response.json();
}

/**
 * Cancel an upload session
 */
export async function cancelUpload(sessionId: string): Promise<void> {
	await fetch(`/api/upload?sessionId=${sessionId}`, {
		method: 'DELETE'
	});
}

/**
 * Clear stored session for a file
 */
export function clearStoredSession(file: File): void {
	localStorage.removeItem(`${STORAGE_KEY_PREFIX}${file.name}_${file.size}`);
}

export interface UploadOptions {
	milestoneId?: string;
	chunkSize?: number;
	concurrency?: number; // Number of parallel chunk uploads
	maxRetries?: number;
	retryDelay?: number;
	onProgress?: (progress: UploadProgress) => void;
	onChunkComplete?: (chunkIndex: number, total: number) => void;
	onError?: (error: Error, chunkIndex?: number) => void;
	signal?: AbortSignal;
}

/**
 * Main upload function with full progress tracking and resumability
 */
export async function uploadFile(
	file: File,
	options: UploadOptions = {}
): Promise<UploadResult> {
	const {
		milestoneId,
		chunkSize = 256 * 1024,
		concurrency = 3,
		maxRetries = 3,
		retryDelay = 1000,
		onProgress,
		onChunkComplete,
		onError,
		signal
	} = options;

	// Initialize or resume session
	const session = await initializeUpload(file, milestoneId, chunkSize);
	
	// Get current status (for resume)
	const status = await getUploadStatus(session.sessionId);
	const uploadedChunks = new Set(status?.uploadedChunks || []);
	
	// Prepare chunks to upload
	const chunks = Array.from(chunkFile(file, session.chunkSize));
	const pendingChunks = chunks.filter(c => !uploadedChunks.has(c.index));
	
	// Progress tracking
	let completedCount = uploadedChunks.size;
	const startTime = Date.now();
	let lastProgressTime = startTime;
	let lastBytesUploaded = completedCount * session.chunkSize;

	const updateProgress = () => {
		const now = Date.now();
		const bytesUploaded = Math.min(completedCount * session.chunkSize, file.size);
		const elapsed = (now - startTime) / 1000;
		const recentElapsed = (now - lastProgressTime) / 1000;
		const recentBytes = bytesUploaded - lastBytesUploaded;
		
		const speed = recentElapsed > 0 ? recentBytes / recentElapsed : 0;
		const remaining = file.size - bytesUploaded;
		const eta = speed > 0 ? remaining / speed : 0;

		onProgress?.({
			uploadedChunks: Array.from(uploadedChunks),
			progress: (completedCount / session.totalChunks) * 100,
			bytesUploaded,
			totalBytes: file.size,
			speed,
			eta
		});

		lastProgressTime = now;
		lastBytesUploaded = bytesUploaded;
	};

	// Initial progress update
	updateProgress();

	// Upload chunks with concurrency control
	const queue = [...pendingChunks];
	const inFlight = new Map<number, Promise<void>>();
	const errors: Array<{ chunkIndex: number; error: Error }> = [];

	const uploadNext = async (): Promise<void> => {
		while (queue.length > 0 && inFlight.size < concurrency) {
			if (signal?.aborted) {
				throw new Error('Upload cancelled');
			}

			const chunk = queue.shift()!;
			const promise = (async () => {
				try {
					await uploadChunkWithRetry(
						session.sessionId,
						chunk.index,
						chunk.blob,
						maxRetries,
						retryDelay,
						signal
					);
					uploadedChunks.add(chunk.index);
					completedCount++;
					onChunkComplete?.(chunk.index, session.totalChunks);
					updateProgress();
				} catch (err) {
					const error = err instanceof Error ? err : new Error(String(err));
					errors.push({ chunkIndex: chunk.index, error });
					onError?.(error, chunk.index);
				} finally {
					inFlight.delete(chunk.index);
				}
			})();

			inFlight.set(chunk.index, promise);
		}

		if (inFlight.size > 0) {
			await Promise.race(inFlight.values());
			await uploadNext();
		}
	};

	await uploadNext();

	// Check for errors
	if (errors.length > 0) {
		const failedChunks = errors.map(e => e.chunkIndex);
		throw new Error(`Upload failed for chunks: ${failedChunks.join(', ')}`);
	}

	// Complete the upload
	const result = await completeUpload(session.sessionId);
	
	// Clear stored session on success
	clearStoredSession(file);

	return result;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format seconds to human readable duration
 */
export function formatDuration(seconds: number): string {
	if (!isFinite(seconds) || seconds < 0) return '--';
	if (seconds < 60) return `${Math.round(seconds)}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
