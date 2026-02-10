// Chunked Upload Utilities
// Provides robust file uploading with resumability, progress tracking, and error recovery
// Implements battle-tested patterns: timeouts, retries with exponential backoff, AIMD concurrency

import { AIMDController, createAIMDController } from './upload/aimd';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';

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
	retryCount?: number; // Number of retries that have occurred
	currentConcurrency?: number; // Current number of parallel uploads
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

// Constants for retry and timeout behavior
const DEFAULT_CHUNK_TIMEOUT_MS = 30000; // 30 seconds per chunk
const MIN_CHUNK_TIMEOUT_MS = 15000; // Minimum timeout
const MAX_CHUNK_TIMEOUT_MS = 120000; // Maximum timeout for slow connections
const STALL_DETECTION_INTERVAL_MS = 5000; // Check for stalls every 5 seconds
const SPEED_SAMPLE_SIZE = 10; // Number of speed samples to keep for timeout calculation

// Speed samples for adaptive timeout (not concurrency - that's handled by AIMD)
let recentSpeeds: number[] = [];

const STORAGE_KEY_PREFIX = 'upload_session_';

/**
 * Compute SHA-256 checksum of a buffer (truncated to 32 chars)
 * Uses pure JS implementation from @oslojs/crypto - works reliably everywhere
 */
function computeChecksum(data: ArrayBuffer): string {
	const hash = sha256(new Uint8Array(data));
	return encodeHexLowerCase(hash).substring(0, 32);
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
 * Calculate adaptive timeout based on chunk size and network conditions
 */
function calculateChunkTimeout(chunkSize: number): number {
	// Base timeout on average recent speeds
	if (recentSpeeds.length > 0) {
		const avgSpeed = recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
		if (avgSpeed > 0) {
			// Estimate time needed plus 50% buffer
			const estimatedTime = (chunkSize / avgSpeed) * 1000 * 1.5;
			return Math.max(MIN_CHUNK_TIMEOUT_MS, Math.min(MAX_CHUNK_TIMEOUT_MS, estimatedTime));
		}
	}
	return DEFAULT_CHUNK_TIMEOUT_MS;
}

/**
 * Update network quality metrics after a chunk upload
 * Note: Concurrency is now controlled by AIMD, this just tracks speed for timeout calculation
 */
function updateSpeedMetrics(chunkSize: number, durationMs: number) {
	if (durationMs > 0) {
		const speed = (chunkSize / durationMs) * 1000; // bytes per second
		recentSpeeds.push(speed);
		if (recentSpeeds.length > SPEED_SAMPLE_SIZE) {
			recentSpeeds.shift();
		}
	}
}

/**
 * Create an AbortController that times out after the specified duration
 */
function createTimeoutController(timeoutMs: number, parentSignal?: AbortSignal): { controller: AbortController; cleanup: () => void } {
	const controller = new AbortController();
	
	// Abort if parent signal is aborted
	const parentAbortHandler = () => controller.abort();
	if (parentSignal) {
		if (parentSignal.aborted) {
			controller.abort();
		} else {
			parentSignal.addEventListener('abort', parentAbortHandler);
		}
	}
	
	// Set up timeout
	const timeoutId = setTimeout(() => {
		controller.abort();
	}, timeoutMs);
	
	const cleanup = () => {
		clearTimeout(timeoutId);
		if (parentSignal) {
			parentSignal.removeEventListener('abort', parentAbortHandler);
		}
	};
	
	return { controller, cleanup };
}

/**
 * Upload a single chunk with retry logic, timeout, and stall detection
 * Uses XMLHttpRequest for real-time upload progress tracking
 */
async function uploadChunkWithRetry(
	sessionId: string,
	chunkIndex: number,
	chunkBlob: Blob,
	maxRetries: number = 5,
	retryDelay: number = 1000,
	signal?: AbortSignal,
	onRetry?: (attempt: number, maxRetries: number, error: Error) => void,
	onProgress?: (bytesSent: number, totalBytes: number) => void
): Promise<ChunkUploadResult & { durationMs: number }> {
	let lastError: Error | null = null;
	const chunkSize = chunkBlob.size;
	
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const startTime = Date.now();
		
		try {
			if (signal?.aborted) {
				throw new Error('Upload cancelled');
			}

			// Calculate adaptive timeout based on network conditions
			const timeout = calculateChunkTimeout(chunkSize);
			
			// Compute checksum for data integrity verification
			const arrayBuffer = await chunkBlob.arrayBuffer();
			const checksum = computeChecksum(arrayBuffer);
			
			const result = await new Promise<ChunkUploadResult>((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				let aborted = false;
				
				// Set up timeout
				const timeoutId = setTimeout(() => {
					if (!aborted) {
						aborted = true;
						xhr.abort();
						reject(new Error(`Chunk ${chunkIndex} upload timed out after ${timeout}ms`));
					}
				}, timeout);
				
				// Handle parent signal abort
				const abortHandler = () => {
					if (!aborted) {
						aborted = true;
						clearTimeout(timeoutId);
						xhr.abort();
						reject(new Error('Upload cancelled'));
					}
				};
				signal?.addEventListener('abort', abortHandler);
				
				// Real-time upload progress tracking
				xhr.upload.onprogress = (event) => {
					if (event.lengthComputable && !aborted) {
						onProgress?.(event.loaded, event.total);
					}
				};
				
				xhr.onload = () => {
					clearTimeout(timeoutId);
					signal?.removeEventListener('abort', abortHandler);
					
					if (xhr.status >= 200 && xhr.status < 300) {
						try {
							const response = JSON.parse(xhr.responseText);
							resolve(response);
						} catch {
							reject(new Error(`Invalid response for chunk ${chunkIndex}`));
						}
					} else {
						try {
							const error = JSON.parse(xhr.responseText);
							reject(new Error(error.message || `Chunk ${chunkIndex} upload failed`));
						} catch {
							reject(new Error(`Chunk ${chunkIndex} upload failed with status ${xhr.status}`));
						}
					}
				};
				
				xhr.onerror = () => {
					clearTimeout(timeoutId);
					signal?.removeEventListener('abort', abortHandler);
					if (!aborted) {
						reject(new Error(`Network error uploading chunk ${chunkIndex}`));
					}
				};
				
				xhr.onabort = () => {
					clearTimeout(timeoutId);
					signal?.removeEventListener('abort', abortHandler);
					// Only reject if we haven't already
				};
				
				// Prepare and send
				const formData = new FormData();
				formData.append('sessionId', sessionId);
				formData.append('chunkIndex', chunkIndex.toString());
				// Provide an explicit safe filename to avoid header encoding issues
				formData.append('chunk', chunkBlob, `chunk_${chunkIndex}`);
				formData.append('checksum', checksum);
				
				xhr.open('POST', '/api/upload/chunk');
				xhr.send(formData);
			});
			
			const durationMs = Date.now() - startTime;
			
			// Update speed metrics on success (AIMD handles concurrency)
			updateSpeedMetrics(chunkSize, durationMs);
			
			return { ...result, durationMs };
		} catch (err) {
			const durationMs = Date.now() - startTime;
			lastError = err instanceof Error ? err : new Error(String(err));
			
			// Check if this was a user-initiated cancel (not a timeout)
			if (signal?.aborted) {
				throw new Error('Upload cancelled');
			}
			
			// Determine if this was a timeout
			const isTimeout = lastError.message.includes('timed out') || lastError.message.includes('aborted');
			const errorType = isTimeout ? 'timeout' : 'error';
			
			// Note: AIMD controller handles concurrency on failure, no need for speed tracking here

			if (attempt < maxRetries - 1) {
				// Exponential backoff with jitter for better retry distribution
				const baseDelay = retryDelay * Math.pow(2, attempt);
				const jitter = Math.random() * baseDelay * 0.3; // 30% jitter
				const delay = Math.min(baseDelay + jitter, 30000); // Cap at 30 seconds
				
				console.log(`Chunk ${chunkIndex} ${errorType}, attempt ${attempt + 1}/${maxRetries}, retrying in ${Math.round(delay)}ms...`, lastError.message);
				onRetry?.(attempt + 1, maxRetries, lastError);
				
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
	concurrency?: number; // Base number of parallel chunk uploads (may be reduced adaptively)
	maxRetries?: number;
	retryDelay?: number;
	chunkTimeout?: number; // Timeout per chunk in milliseconds
	adaptiveConcurrency?: boolean; // Reduce concurrency on poor network conditions
	onProgress?: (progress: UploadProgress) => void;
	onChunkComplete?: (chunkIndex: number, total: number) => void;
	onRetry?: (chunkIndex: number, attempt: number, maxRetries: number, error: Error) => void;
	onError?: (error: Error, chunkIndex?: number) => void;
	signal?: AbortSignal;
}

/**
 * Main upload function with full progress tracking, resumability, and network resilience
 * 
 * Implements battle-tested upload patterns:
 * - Automatic retry with exponential backoff and jitter
 * - Per-chunk timeout with adaptive adjustment based on network conditions
 * - Adaptive concurrency that reduces parallelism on poor connections
 * - Resume support for interrupted uploads
 * - Checksum verification for data integrity
 */
export async function uploadFile(
	file: File,
	options: UploadOptions = {}
): Promise<UploadResult> {
	const {
		milestoneId,
		chunkSize = 256 * 1024, // 256KB chunks work well for mobile
		concurrency: baseConcurrency = 3,
		maxRetries = 5, // Increased from 3 for better mobile resilience
		retryDelay = 1000,
		adaptiveConcurrency = true,
		onProgress,
		onChunkComplete,
		onRetry,
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
	let totalRetryCount = 0;
	const startTime = Date.now();
	let lastProgressTime = startTime;
	let smoothedSpeed = 0; // Exponential moving average for speed
	let lastBytesUploaded = 0; // Track bytes at last speed calculation
	let lastBytesTime = startTime; // When we last saw byte progress
	
	// Track in-progress bytes for real-time progress (chunk index -> bytes sent)
	const inProgressBytes = new Map<number, number>();

	// Create AIMD controller for adaptive concurrency (TCP-like congestion control)
	const aimdController = createAIMDController(baseConcurrency);

	// Determine effective concurrency using AIMD controller
	const getEffectiveConcurrency = () => {
		if (!adaptiveConcurrency) return baseConcurrency;
		return aimdController.currentConcurrency;
	};

	const updateProgress = () => {
		const now = Date.now();
		
		// Calculate bytes: completed chunks + in-progress bytes
		const completedBytes = completedCount * session.chunkSize;
		const currentInProgress = Array.from(inProgressBytes.values()).reduce((a, b) => a + b, 0);
		const bytesUploaded = Math.min(completedBytes + currentInProgress, file.size);
		
		const recentElapsed = (now - lastProgressTime) / 1000;
		
		// Calculate instantaneous speed (only if enough time has passed)
		if (recentElapsed >= 0.2) { // Update every 200ms minimum
			const bytesSinceLastCalc = bytesUploaded - lastBytesUploaded;
			const timeSinceLastCalc = (now - lastBytesTime) / 1000;
			
			// If bytes are making progress, calculate speed
			if (bytesSinceLastCalc > 0) {
				const instantSpeed = bytesSinceLastCalc / timeSinceLastCalc;
				
				// Use EMA for smoother speed display
				smoothedSpeed = smoothedSpeed === 0 
					? instantSpeed 
					: smoothedSpeed * 0.7 + instantSpeed * 0.3;
				
				lastBytesUploaded = bytesUploaded;
				lastBytesTime = now;
			} else if (timeSinceLastCalc > 2) {
				// No progress for 2+ seconds = stalled, decay speed rapidly
				smoothedSpeed = smoothedSpeed * 0.5;
				if (smoothedSpeed < 1000) smoothedSpeed = 0; // Below 1KB/s = 0
			}
			
			lastProgressTime = now;
		}
		
		const remaining = file.size - bytesUploaded;
		const eta = smoothedSpeed > 0 ? remaining / smoothedSpeed : 0;

		// Use bytesUploaded for more granular progress
		const progressPercent = (bytesUploaded / file.size) * 100;

		onProgress?.({
			uploadedChunks: Array.from(uploadedChunks),
			progress: progressPercent,
			bytesUploaded,
			totalBytes: file.size,
			speed: smoothedSpeed,
			eta,
			retryCount: totalRetryCount,
			currentConcurrency: getEffectiveConcurrency()
		});
	};

	// Initial progress update
	updateProgress();

	// Upload chunks with adaptive concurrency control
	const queue = [...pendingChunks];
	const inFlight = new Map<number, Promise<void>>();
	const errors: Array<{ chunkIndex: number; error: Error }> = [];

	const uploadNext = async (): Promise<void> => {
		// Use adaptive concurrency
		const effectiveConcurrency = getEffectiveConcurrency();
		
		while (queue.length > 0 && inFlight.size < effectiveConcurrency) {
			if (signal?.aborted) {
				throw new Error('Upload cancelled');
			}

			const chunk = queue.shift()!;
			const chunkSize = chunk.blob.size;
			const promise = (async () => {
				try {
					// Initialize in-progress tracking for this chunk
					inProgressBytes.set(chunk.index, 0);
					
					const result = await uploadChunkWithRetry(
						session.sessionId,
						chunk.index,
						chunk.blob,
						maxRetries,
						retryDelay,
						signal,
						(attempt, max, error) => {
							totalRetryCount++;
							// Reset progress on retry
							inProgressBytes.set(chunk.index, 0);
							// Notify AIMD of retry (doesn't immediately affect concurrency)
							aimdController.onEvent({ type: 'retry', attempt, maxAttempts: max });
							onRetry?.(chunk.index, attempt, max, error);
							updateProgress();
						},
						(bytesSent, _totalBytes) => {
							// Real-time byte progress from XMLHttpRequest
							inProgressBytes.set(chunk.index, bytesSent);
							updateProgress();
						}
					);
					
					// Chunk complete - remove from in-progress
					inProgressBytes.delete(chunk.index);
					uploadedChunks.add(chunk.index);
					completedCount++;
					
					// Signal success to AIMD controller for concurrency adjustment
					aimdController.onEvent({ type: 'success', durationMs: result.durationMs, chunkSize });
					
					onChunkComplete?.(chunk.index, session.totalChunks);
					updateProgress();
				} catch (err) {
					inProgressBytes.delete(chunk.index);
					const error = err instanceof Error ? err : new Error(String(err));
					errors.push({ chunkIndex: chunk.index, error });
					
					// Determine failure reason for AIMD
					const isTimeout = error.message.includes('timed out');
					const isAbort = error.message.includes('cancelled');
					const reason = isAbort ? 'abort' : isTimeout ? 'timeout' : 'error';
					
					// Signal failure to AIMD controller - will reduce concurrency
					aimdController.onEvent({ type: 'failure', reason });
					
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
	if (!isFinite(seconds) || seconds <= 0) return '∞';
	if (seconds < 60) return `${Math.round(seconds)}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
