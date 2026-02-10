<script lang="ts">
	import {
		uploadFile,
		cancelUpload,
		getUploadStatus,
		formatBytes,
		formatDuration,
		type UploadProgress,
		type UploadResult
	} from '$lib/upload';
	import VideoThumbnail from './VideoThumbnail.svelte';
	import { uploadQueueStore, type QueuedFile } from '$lib/stores/uploadQueue.svelte';

	interface Props {
		milestoneId?: string;
		accept?: string;
		maxSize?: number; // in bytes
		chunkSize?: number;
		concurrency?: number;
		multiple?: boolean; // Allow multiple files
		hasActiveUploads?: boolean; // Bindable: true if uploads are in progress
		onUploadComplete?: (result: UploadResult) => void;
		onUploadError?: (error: Error) => void;
		onAllUploadsComplete?: (results: UploadResult[]) => void;
	}

	let {
		milestoneId,
		accept = 'image/*,video/*',
		maxSize = 500 * 1024 * 1024, // 500MB
		chunkSize = 256 * 1024, // 256KB
		concurrency = 3,
		multiple = true,
		hasActiveUploads = $bindable(false),
		onUploadComplete,
		onUploadError,
		onAllUploadsComplete
	}: Props = $props();

	// Queue key for the store (use milestoneId or a fallback for non-milestone uploads)
	let queueKey = $derived(milestoneId ?? '_default_upload_queue');

	// Abort controllers are kept local (can't be serialized to store)
	const abortControllers = new Map<string, AbortController>();

	// Get queue state from the store using pure getters for proper reactivity
	let fileQueue = $derived(uploadQueueStore.getFiles(queueKey));
	let currentUploadIndex = $derived(uploadQueueStore.getCurrentIndex(queueKey));
	let allResults = $derived(uploadQueueStore.getResults(queueKey));
	
	// Legacy single-file state (for backward compatibility)
	type UploadStateType = 'idle' | 'preparing' | 'uploading' | 'paused' | 'completing' | 'completed' | 'error';
	let uploadState = $state<UploadStateType>('idle');
	let selectedFile = $state<File | null>(null);
	let progress = $state<UploadProgress | null>(null);
	let error = $state<string | null>(null);
	let result = $state<UploadResult | null>(null);
	let abortController = $state<AbortController | null>(null);
	let sessionId = $state<string | null>(null);
	let isDragging = $state(false);
	
	// Derived state for queue - now use store's getStats for efficiency
	let queueStats = $derived(uploadQueueStore.getStats(queueKey));
	let isQueueMode = $derived(fileQueue.length > 0);
	let queueCompleted = $derived(uploadQueueStore.isQueueCompleted(queueKey));
	let uploadingCount = $derived(queueStats.uploading);
	let completedCount = $derived(queueStats.completed);
	let failedCount = $derived(queueStats.failed);
	let pendingCount = $derived(queueStats.pending);
	let totalQueueProgress = $derived(queueStats.progress);

	// Derived state
	let progressPercent = $derived(progress?.progress ?? 0);
	let canPause = $derived(uploadState === 'uploading');
	let canResume = $derived(uploadState === 'paused');
	let canCancel = $derived(uploadState === 'uploading' || uploadState === 'paused' || uploadState === 'preparing');

	// Update bindable hasActiveUploads when upload state changes
	$effect(() => {
		const queueActive = fileQueue.some(f => 
			f.state === 'uploading' || f.state === 'preparing' || f.state === 'completing' || f.state === 'paused'
		);
		const singleActive = uploadState === 'uploading' || uploadState === 'preparing' || uploadState === 'completing' || uploadState === 'paused';
		hasActiveUploads = queueActive || singleActive;
	});

	// Wake Lock API - prevents device from sleeping during uploads
	let wakeLock = $state<WakeLockSentinel | null>(null);

	async function requestWakeLock() {
		if (!('wakeLock' in navigator)) {
			console.log('Wake Lock API not supported');
			return;
		}
		try {
			wakeLock = await navigator.wakeLock.request('screen');
			console.log('Wake lock acquired - screen will stay on during upload');
			
			// Wake lock is released when document becomes hidden
			wakeLock.addEventListener('release', () => {
				wakeLock = null;
				console.log('Wake lock released');
			});
		} catch (err) {
			console.log('Failed to acquire wake lock:', (err as Error).message);
		}
	}

	function releaseWakeLock() {
		if (wakeLock) {
			wakeLock.release();
			wakeLock = null;
		}
	}

	// Re-acquire wake lock when page becomes visible again during active upload
	function handleVisibilityChange() {
		if (document.visibilityState === 'visible' && hasActiveUploads && !wakeLock) {
			requestWakeLock();
		}
	}

	// Manage wake lock based on upload state
	$effect(() => {
		if (hasActiveUploads) {
			requestWakeLock();
			document.addEventListener('visibilitychange', handleVisibilityChange);
		} else {
			releaseWakeLock();
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		}
		
		// Cleanup on component destroy
		return () => {
			releaseWakeLock();
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (files && files.length > 0) {
			if (multiple && files.length > 1) {
				selectMultipleFiles(Array.from(files));
			} else {
				selectFile(files[0]);
			}
		}
		// Reset the input so the same files can be selected again
		input.value = '';
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;
		const files = event.dataTransfer?.files;
		if (files && files.length > 0) {
			if (multiple && files.length > 1) {
				selectMultipleFiles(Array.from(files));
			} else {
				selectFile(files[0]);
			}
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	function validateFile(file: File): string | null {
		// Validate file size
		if (file.size > maxSize) {
			return `File too large. Maximum size is ${formatBytes(maxSize)}`;
		}

		// Validate file type
		if (accept && accept !== '*') {
			const acceptTypes = accept.split(',').map(t => t.trim());
			const fileName = file.name.toLowerCase();
			const isValid = acceptTypes.some(type => {
				if (type.endsWith('/*')) {
					const category = type.slice(0, -2);
					// Also accept HEIC/HEIF as images (will be converted server-side)
					if (category === 'image' && (fileName.endsWith('.heic') || fileName.endsWith('.heif'))) {
						return true;
					}
					return file.type.startsWith(category);
				}
				return file.type === type || fileName.endsWith(type);
			});
			if (!isValid) {
				return `Invalid file type. Accepted: ${accept}`;
			}
		}
		return null;
	}

	function selectFile(file: File) {
		const validationError = validateFile(file);
		if (validationError) {
			error = validationError;
			return;
		}

		selectedFile = file;
		error = null;
		uploadState = 'idle';
		result = null;
		progress = null;
	}
	
	function selectMultipleFiles(files: File[]) {
		// Reset the queue but keep failed files
		const existingFailed = fileQueue.filter(f => f.state === 'error');
		uploadQueueStore.resetQueue(queueKey);
		error = null;
		
		// Build new file list
		const newFiles: QueuedFile[] = [];
		
		// Add back existing failed files
		for (const failed of existingFailed) {
			newFiles.push(failed);
		}
		
		// Add new files
		for (const file of files) {
			const validationError = validateFile(file);
			newFiles.push({
				id: uploadQueueStore.generateFileId(),
				file,
				state: validationError ? 'error' : 'idle',
				progress: null,
				error: validationError,
				result: null,
				sessionId: null
			});
		}
		
		uploadQueueStore.addFiles(queueKey, newFiles);
	}
	
	function addMoreFiles(files: File[]) {
		const newFiles: QueuedFile[] = [];
		for (const file of files) {
			const validationError = validateFile(file);
			newFiles.push({
				id: uploadQueueStore.generateFileId(),
				file,
				state: validationError ? 'error' : 'idle',
				progress: null,
				error: validationError,
				result: null,
				sessionId: null
			});
		}
		uploadQueueStore.addFiles(queueKey, newFiles);
	}
	
	async function removeFromQueue(index: number) {
		const item = fileQueue[index];
		// Abort if in progress
		const controller = abortControllers.get(item.id);
		if (controller) {
			controller.abort();
			abortControllers.delete(item.id);
		}
		// Clear upload session if it exists
		if (item.sessionId) {
			try {
				await cancelUpload(item.sessionId);
			} catch {
				// Ignore errors
			}
		}
		uploadQueueStore.removeFile(queueKey, item.id);
	}
	
	async function dismissFailedItem(index: number) {
		const item = fileQueue[index];
		if (item.state !== 'error') return;
		
		// Clear upload session if it exists
		if (item.sessionId) {
			try {
				await cancelUpload(item.sessionId);
			} catch {
				// Ignore errors
			}
		}
		// Also clear from localStorage
		const storageKey = `upload_session_${item.file.name}_${item.file.size}`;
		localStorage.removeItem(storageKey);
		
		uploadQueueStore.removeFile(queueKey, item.id);
	}
	
	function clearCompletedFiles() {
		// Only remove completed files, keep failed ones
		fileQueue = fileQueue.filter(f => f.state !== 'completed');
	}

	let isPausing = $state(false);

	// Retry tracking for user feedback
	let retryInfo = $state<{ chunkIndex: number; attempt: number; maxRetries: number } | null>(null);

	async function startUpload() {
		if (!selectedFile) return;

		uploadState = 'preparing';
		error = null;
		isPausing = false;
		retryInfo = null;
		abortController = new AbortController();

		try {
			uploadState = 'uploading';
			
			const uploadResult = await uploadFile(selectedFile, {
				milestoneId,
				chunkSize,
				concurrency,
				signal: abortController.signal,
				onProgress: (p) => {
					progress = p;
				},
				onRetry: (chunkIndex, attempt, maxRetries, err) => {
					retryInfo = { chunkIndex, attempt, maxRetries };
					console.log(`Retrying chunk ${chunkIndex}, attempt ${attempt}/${maxRetries}:`, err.message);
				},
				onError: (err, chunkIndex) => {
					console.error(`Chunk ${chunkIndex} error:`, err);
				}
			});

			if (onUploadComplete) await onUploadComplete(uploadResult);

			uploadState = 'completed';
			result = uploadResult;
			retryInfo = null;

			onAllUploadsComplete?.([uploadResult]);
		} catch (err) {
			retryInfo = null;
			if ((err as Error).message === 'Upload cancelled') {
				// Check if this was a pause or a cancel
				if (isPausing) {
					uploadState = 'paused';
				} else {
					uploadState = 'idle';
				}
			} else {
				uploadState = 'error';
				error = (err as Error).message;
				onUploadError?.(err as Error);
			}
		} finally {
			abortController = null;
			isPausing = false;
		}
	}

	function pauseUpload() {
		if (abortController) {
			sessionId = progress?.uploadedChunks ? 'saved' : null; // Mark that we have progress
			isPausing = true;
			abortController.abort();
		}
	}

	async function resumeUpload() {
		if (!selectedFile || uploadState !== 'paused') return;
		await startUpload();
	}

	async function cancelUploadSession() {
		if (abortController) {
			abortController.abort();
		}
		
		// Clear any stored session
		if (selectedFile) {
			const storageKey = `upload_session_${selectedFile.name}_${selectedFile.size}`;
			const storedSessionId = localStorage.getItem(storageKey);
			if (storedSessionId) {
				try {
					await cancelUpload(storedSessionId);
				} catch {
					// Ignore errors
				}
				localStorage.removeItem(storageKey);
			}
		}

		reset();
	}

	function reset() {
		uploadState = 'idle';
		selectedFile = null;
		progress = null;
		error = null;
		result = null;
		abortController = null;
		sessionId = null;
		isPausing = false;
	}
	
	function resetQueue() {
		uploadQueueStore.resetQueue(queueKey);
		abortControllers.clear();
		error = null;
	}
	
	function resetAll() {
		reset();
		resetQueue();
	}
	
	// Queue upload functions
	async function startQueueUpload() {
		if (fileQueue.length === 0) return;
		
		// Clear previous results in the store
		uploadQueueStore.clearResults(queueKey);
		
		for (let i = 0; i < fileQueue.length; i++) {
			const item = fileQueue[i];
			if (item.state === 'error' || item.state === 'completed') continue; // Skip files with validation errors or already completed
			
			// Set up state via store
			uploadQueueStore.setCurrentIndex(queueKey, i);
			const controller = new AbortController();
			abortControllers.set(item.id, controller);
			
			uploadQueueStore.updateFile(queueKey, item.id, {
				state: 'preparing',
				error: null
			});
			
			try {
				uploadQueueStore.updateFile(queueKey, item.id, { state: 'uploading' });
				
				const uploadResult = await uploadFile(item.file, {
					milestoneId,
					chunkSize,
					concurrency,
					signal: controller.signal,
					onProgress: (p) => {
						uploadQueueStore.updateFile(queueKey, item.id, { progress: p });
					},
					onRetry: (chunkIndex, attempt, maxRetries, err) => {
						console.log(`[${item.file.name}] Retrying chunk ${chunkIndex}, attempt ${attempt}/${maxRetries}:`, err.message);
					},
					onError: (err, chunkIndex) => {
						console.error(`Chunk ${chunkIndex} error:`, err);
					}
				});
				
				if (onUploadComplete) await onUploadComplete(uploadResult);

				uploadQueueStore.updateFile(queueKey, item.id, {
					state: 'completed',
					result: uploadResult
				});
				uploadQueueStore.addResult(queueKey, uploadResult);
			} catch (err) {
				if ((err as Error).message === 'Upload cancelled') {
					uploadQueueStore.updateFile(queueKey, item.id, { state: 'idle' });
				} else {
					uploadQueueStore.updateFile(queueKey, item.id, {
						state: 'error',
						error: (err as Error).message
					});
					onUploadError?.(err as Error);
				}
			} finally {
				abortControllers.delete(item.id);
			}
		}
		
		uploadQueueStore.setCurrentIndex(queueKey, -1);
		const finalResults = uploadQueueStore.getResults(queueKey);
		if (finalResults.length > 0) {
			onAllUploadsComplete?.(finalResults);
		}
	}
	
	async function cancelQueueUploads() {
		// Abort all in-progress uploads
		for (const [id, controller] of abortControllers) {
			controller.abort();
		}
		abortControllers.clear();
		resetQueue();
	}
	
	async function retryQueueItem(index: number) {
		const item = fileQueue[index];
		if (!item || item.state !== 'error') return;
		
		// Reset item state via store
		const controller = new AbortController();
		abortControllers.set(item.id, controller);
		
		uploadQueueStore.updateFile(queueKey, item.id, {
			state: 'preparing',
			error: null,
			progress: null
		});
		
		try {
			uploadQueueStore.updateFile(queueKey, item.id, { state: 'uploading' });
			
			const uploadResult = await uploadFile(item.file, {
				milestoneId,
				chunkSize,
				concurrency,
				signal: controller.signal,
				onProgress: (p) => {
					uploadQueueStore.updateFile(queueKey, item.id, { progress: p });
				},
				onRetry: (chunkIndex, attempt, maxRetries, err) => {
					console.log(`[${item.file.name}] Retrying chunk ${chunkIndex}, attempt ${attempt}/${maxRetries}:`, err.message);
				},
				onError: (err, chunkIndex) => {
					console.error(`Chunk ${chunkIndex} error:`, err);
				}
			});
			
			if (onUploadComplete) await onUploadComplete(uploadResult);

			uploadQueueStore.updateFile(queueKey, item.id, {
				state: 'completed',
				result: uploadResult
			});
			uploadQueueStore.addResult(queueKey, uploadResult);
		} catch (err) {
			if ((err as Error).message === 'Upload cancelled') {
				uploadQueueStore.updateFile(queueKey, item.id, { state: 'idle' });
			} else {
				uploadQueueStore.updateFile(queueKey, item.id, {
					state: 'error',
					error: (err as Error).message
				});
				onUploadError?.(err as Error);
			}
		} finally {
			abortControllers.delete(item.id);
		}
	}

	function getFilePreview(file: File): string | null {
		if (file.type.startsWith('image/')) {
			return URL.createObjectURL(file);
		}
		return null;
	}
</script>

<div class="chunked-uploader">
	{#if isQueueMode}
		<!-- Multiple Files Queue Mode -->
		<div class="upload-queue">
			<div class="queue-header">
				<span class="queue-count">{fileQueue.length} file{fileQueue.length !== 1 ? 's' : ''} selected</span>
				{#if !queueCompleted && uploadingCount === 0}
					<label class="add-more-label">
						<span class="add-more-btn">+ Add more</span>
						<input
							type="file"
							{accept}
							multiple
							onchange={(e) => {
								const files = (e.target as HTMLInputElement).files;
								if (files) addMoreFiles(Array.from(files));
								(e.target as HTMLInputElement).value = '';
							}}
							class="file-input"
						/>
					</label>
				{/if}
			</div>
			
			<div class="queue-list">
				{#each fileQueue as item, index (item.id)}
					<div class="queue-item" class:uploading={item.state === 'uploading'} class:completed={item.state === 'completed'} class:error={item.state === 'error'}>
						<div class="queue-item-info">
							{#if getFilePreview(item.file)}
								<img src={getFilePreview(item.file)} alt="" class="queue-thumb" />
							{:else}
								<div class="queue-icon">
									{#if item.file.type.startsWith('video/')}🎬{:else if item.file.type.startsWith('image/')}🖼️{:else}📄{/if}
								</div>
							{/if}
							<div class="queue-item-details">
								<span class="queue-item-name">{item.file.name}</span>
								<span class="queue-item-size">{formatBytes(item.file.size)}</span>
							</div>
							{#if item.state === 'completed'}
								<span class="queue-item-status success">✓</span>
							{:else if item.state === 'error'}
								<div class="queue-item-actions">
									<button 
										type="button" 
										class="queue-item-retry" 
										onclick={() => retryQueueItem(index)}
										title="Retry upload"
									>↻</button>
									<button 
										type="button" 
										class="queue-item-dismiss" 
										onclick={() => dismissFailedItem(index)}
										title="Dismiss"
									>×</button>
								</div>
							{:else if item.state === 'uploading'}
								<span class="queue-item-status uploading">{(item.progress?.progress ?? 0).toFixed(0)}%</span>
							{:else if uploadingCount === 0}
								<button type="button" class="queue-item-remove" onclick={() => removeFromQueue(index)}>×</button>
							{/if}
						</div>
						{#if item.state === 'uploading' && item.progress}
							<div class="queue-item-progress">
								<div class="progress-fill" style="width: {item.progress.progress}%"></div>
							</div>
							<div class="queue-item-stats">
								<span class="queue-stat bytes">{formatBytes(item.progress.bytesUploaded)} / {formatBytes(item.progress.totalBytes)}</span>
								<span class="queue-stat speed">{formatBytes(item.progress.speed)}/s</span>
								<span class="queue-stat eta">ETA: {formatDuration(item.progress.eta)}</span>
								{#if item.progress.retryCount && item.progress.retryCount > 0}
									<span class="queue-stat retry">↻ {item.progress.retryCount}</span>
								{/if}
							</div>
						{/if}
						{#if item.state === 'error' && item.error}
							<div class="queue-item-error">
								<span class="error-text">{item.error}</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
			
			{#if queueCompleted}
				<div class="queue-complete">
					{#if failedCount === 0}
						<p class="queue-complete-msg success">✓ {completedCount} file{completedCount !== 1 ? 's' : ''} uploaded</p>
						<button type="button" class="btn-secondary" onclick={resetQueue}>Upload More Files</button>
					{:else if completedCount === 0}
						<p class="queue-complete-msg error">✕ {failedCount} upload{failedCount !== 1 ? 's' : ''} failed</p>
						<p class="queue-complete-hint">Dismiss failed files or retry them individually</p>
						<div class="queue-complete-actions">
							<label class="add-more-label">
								<span class="btn-secondary" style="display: inline-block; padding: 0.5rem 1rem;">+ Add More Files</span>
								<input
									type="file"
									{accept}
									multiple
									onchange={(e) => {
										const files = (e.target as HTMLInputElement).files;
										if (files) addMoreFiles(Array.from(files));
										(e.target as HTMLInputElement).value = '';
									}}
									class="file-input"
								/>
							</label>
						</div>
					{:else}
						<p class="queue-complete-msg partial">
							✓ {completedCount} uploaded, ✕ {failedCount} failed
						</p>
						<div class="queue-complete-actions">
							<button type="button" class="btn-secondary" onclick={clearCompletedFiles}>
								Clear Completed
							</button>
						</div>
					{/if}
				</div>
			{:else}
				<div class="queue-actions">
					{#if uploadingCount === 0}
						<button type="button" class="btn-primary" onclick={startQueueUpload}>
							Upload {fileQueue.filter(f => f.state === 'idle').length} File{fileQueue.filter(f => f.state === 'idle').length !== 1 ? 's' : ''}
						</button>
						<button type="button" class="btn-secondary" onclick={resetQueue}>Clear</button>
					{:else}
						<div class="queue-progress-summary">
							<span>Uploading {completedCount + uploadingCount}/{fileQueue.length}</span>
							<div class="progress-bar">
								<div class="progress-fill" style="width: {totalQueueProgress}%"></div>
							</div>
							{#if wakeLock}
								<span class="wake-lock-indicator" title="Screen will stay on during upload">🔒 Screen on</span>
							{/if}
						</div>
						<button type="button" class="btn-danger" onclick={cancelQueueUploads}>Cancel All</button>
					{/if}
				</div>
			{/if}
		</div>
	{:else if uploadState === 'completed' && result}
		<!-- Upload Complete -->
		<div class="upload-complete">
			<div class="success-icon">✓</div>
			<h3>Upload Complete</h3>
			<p class="filename">{result.filename}</p>
			<p class="filesize">{formatBytes(result.fileSize)}</p>
				{#if result.url}
				<div class="preview">
					{#if result.mimeType.startsWith('image/')}
						<img src={result.url} alt={result.filename} class="preview-image" />
					{:else if result.mimeType.startsWith('video/')}
						<VideoThumbnail
							url={result.url}
							thumbnailUrl={result.thumbnailUrl}
							videoJobId={result.videoProcessingJobId}
							playable={true}
						/>
					{/if}
				</div>
			{/if}
			<button type="button" class="btn-secondary" onclick={reset}>
				Upload Another
			</button>
		</div>
	{:else if selectedFile}
		<!-- File Selected - Upload Controls -->
		<div class="upload-controls">
			<div class="file-info">
				{#if getFilePreview(selectedFile)}
					<img src={getFilePreview(selectedFile)} alt="" class="file-preview" />
				{:else}
					<div class="file-icon">
						{#if selectedFile.type.startsWith('video/')}
							🎬
						{:else if selectedFile.type.startsWith('image/')}
							🖼️
						{:else}
							📄
						{/if}
					</div>
				{/if}
				<div class="file-details">
					<span class="file-name">{selectedFile.name}</span>
					<span class="file-size">{formatBytes(selectedFile.size)}</span>
				</div>
				{#if uploadState === 'idle'}
					<button type="button" class="btn-icon" onclick={reset} title="Remove file">
						×
					</button>
				{/if}
			</div>

			{#if progress && uploadState !== 'idle'}
				<!-- Progress Display -->
				<div class="progress-container">
					<div class="progress-bar">
						<div
							class="progress-fill"
							class:paused={uploadState === 'paused'}
							class:retrying={retryInfo !== null}
							style="width: {progressPercent}%"
						></div>
					</div>
					<div class="progress-stats">
						<span class="progress-percent">{progressPercent.toFixed(1)}%</span>
						<span class="progress-bytes">
							{formatBytes(progress.bytesUploaded)} / {formatBytes(progress.totalBytes)}
						</span>
						{#if uploadState === 'uploading' && progress.speed > 0}
							<span class="progress-speed">{formatBytes(progress.speed)}/s</span>
							<span class="progress-eta">ETA: {formatDuration(progress.eta)}</span>
						{/if}
					</div>
					{#if retryInfo}
						<div class="retry-info">
							🔄 Retrying chunk (attempt {retryInfo.attempt}/{retryInfo.maxRetries})...
						</div>
					{:else}
						<div class="chunk-info">
							{progress.uploadedChunks.length} chunks uploaded
							{#if progress.retryCount && progress.retryCount > 0}
								<span class="retry-count">({progress.retryCount} retries)</span>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if error}
				<div class="error-message">
					<span class="error-icon">⚠️</span>
					{error}
				</div>
			{/if}

			<div class="action-buttons">
				{#if uploadState === 'idle' || uploadState === 'error'}
					<button type="button" class="btn-primary" onclick={startUpload}>
						{uploadState === 'error' ? 'Retry Upload' : 'Start Upload'}
					</button>
				{:else if uploadState === 'uploading' || uploadState === 'preparing'}
					<button type="button" class="btn-secondary" onclick={pauseUpload} disabled={!canPause}>
						⏸ Pause
					</button>
				{:else if uploadState === 'paused'}
					<button type="button" class="btn-primary" onclick={resumeUpload}>
						▶ Resume
					</button>
				{:else if uploadState === 'completing'}
					<button type="button" class="btn-secondary" disabled>
						Completing...
					</button>
				{/if}

				{#if canCancel}
					<button type="button" class="btn-danger" onclick={cancelUploadSession}>
						Cancel
					</button>
				{/if}
			</div>

			{#if uploadState === 'paused'}
				<p class="pause-note">
					Upload paused. Your progress is saved and you can resume later.
				</p>
			{/if}
		</div>
	{:else}
		<!-- Drop Zone -->
		<div
			class="drop-zone"
			class:dragging={isDragging}
			ondrop={handleDrop}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			role="button"
			tabindex="0"
		>
			<div class="drop-zone-content">
				<div class="upload-icon">📁</div>
				<p class="drop-text">
					Drag & drop {multiple ? 'files' : 'a file'} here, or
					<label class="file-label">
						<span>browse</span>
						<input
							type="file"
							{accept}
							multiple={multiple}
							onchange={handleFileSelect}
							class="file-input"
						/>
					</label>
				</p>
				<p class="size-limit">Max file size: {formatBytes(maxSize)}</p>
			</div>
		</div>
	{/if}

	{#if error && !selectedFile}
		<div class="error-message standalone">
			<span class="error-icon">⚠️</span>
			{error}
		</div>
	{/if}
</div>

<style>
	.chunked-uploader {
		width: 100%;
	}

	/* Drop Zone */
	.drop-zone {
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		text-align: center;
		transition: all 0.2s ease;
		cursor: pointer;
		background: var(--color-bg-secondary);
	}

	.drop-zone:hover,
	.drop-zone.dragging {
		border-color: var(--color-primary);
		background: var(--color-primary-light);
	}

	.drop-zone-content {
		pointer-events: none;
	}

	.upload-icon {
		font-size: 3rem;
		margin-bottom: 1rem;
	}

	.drop-text {
		color: var(--color-text-secondary);
		margin-bottom: 0.5rem;
	}

	.file-label {
		color: var(--color-primary);
		cursor: pointer;
		pointer-events: auto;
	}

	.file-label:hover {
		text-decoration: underline;
	}

	.file-input {
		display: none;
	}

	.size-limit {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* File Info */
	.upload-controls {
		background: var(--color-bg-secondary);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
	}

	.file-info {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.file-preview {
		width: 60px;
		height: 60px;
		object-fit: cover;
		border-radius: var(--radius-md);
	}

	.file-icon {
		width: 60px;
		height: 60px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		font-size: 1.5rem;
	}

	.file-details {
		flex: 1;
		min-width: 0;
	}

	.file-name {
		display: block;
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.file-size {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.btn-icon {
		width: 32px;
		height: 32px;
		border: none;
		background: var(--color-bg-elevated);
		color: var(--color-text-muted);
		border-radius: 50%;
		cursor: pointer;
		font-size: 1.25rem;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.btn-icon:hover {
		background: var(--color-error);
		color: white;
	}

	/* Progress */
	.progress-container {
		margin-bottom: 1rem;
	}

	.progress-bar {
		height: 8px;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-full);
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-primary);
		border-radius: var(--radius-full);
		transition: width 0.3s ease;
	}

	.progress-fill.paused {
		background: var(--color-warning);
	}

	.progress-fill.retrying {
		background: var(--color-warning);
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}

	.progress-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.progress-percent {
		font-weight: 600;
		color: var(--color-text);
	}

	.chunk-info {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.retry-info {
		font-size: 0.75rem;
		color: var(--color-warning);
		margin-top: 0.25rem;
		animation: pulse 1s ease-in-out infinite;
	}

	.retry-count {
		color: var(--color-text-muted);
		margin-left: 0.25rem;
	}

	/* Error */
	.error-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--color-error);
		border-radius: var(--radius-md);
		color: var(--color-error);
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}

	.error-message.standalone {
		margin-top: 1rem;
		margin-bottom: 0;
	}

	.error-icon {
		flex-shrink: 0;
	}

	/* Buttons */
	.action-buttons {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.btn-primary,
	.btn-secondary,
	.btn-danger {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-primary {
		background: var(--color-primary);
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	.btn-secondary {
		background: var(--color-bg-elevated);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--color-bg);
	}

	.btn-danger {
		background: transparent;
		color: var(--color-error);
		border: 1px solid var(--color-error);
	}

	.btn-danger:hover:not(:disabled) {
		background: var(--color-error);
		color: white;
	}

	.btn-primary:disabled,
	.btn-secondary:disabled,
	.btn-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.pause-note {
		margin-top: 1rem;
		font-size: 0.875rem;
		color: var(--color-warning);
		font-style: italic;
	}

	/* Complete State */
	.upload-complete {
		text-align: center;
		padding: 2rem;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-lg);
	}

	.success-icon {
		width: 64px;
		height: 64px;
		margin: 0 auto 1rem;
		background: var(--color-success);
		color: white;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2rem;
	}

	.upload-complete h3 {
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.upload-complete .filename {
		font-weight: 500;
		color: var(--color-text);
	}

	.upload-complete .filesize {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}

	.preview {
		margin: 1rem 0;
	}

	.preview-image {
		max-width: 100%;
		max-height: 300px;
		border-radius: var(--radius-md);
		margin: 0 auto;
	}

	/* Queue Mode Styles */
	.upload-queue {
		background: var(--color-bg-secondary);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}

	.queue-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-border);
	}

	.queue-count {
		font-weight: 500;
		color: var(--color-text);
	}

	.add-more-label {
		cursor: pointer;
	}

	.add-more-btn {
		color: var(--color-primary);
		font-size: 0.875rem;
	}

	.add-more-btn:hover {
		text-decoration: underline;
	}

	.queue-list {
		max-height: 300px;
		overflow-y: auto;
		margin-bottom: 0.75rem;
	}

	.queue-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.5rem;
		border-radius: var(--radius-md);
		margin-bottom: 0.25rem;
		background: var(--color-bg);
	}

	.queue-item.uploading {
		background: rgba(59, 130, 246, 0.1);
	}

	.queue-item.completed {
		background: rgba(34, 197, 94, 0.1);
	}

	.queue-item.error {
		background: rgba(239, 68, 68, 0.1);
	}

	.queue-item-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.queue-thumb {
		width: 32px;
		height: 32px;
		object-fit: cover;
		border-radius: var(--radius-sm);
	}

	.queue-icon {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
	}

	.queue-item-details {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.queue-item-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.queue-item-size {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.queue-item-status {
		font-size: 0.75rem;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
	}

	.queue-item-status.success {
		color: var(--color-success);
	}

	.queue-item-status.uploading {
		color: var(--color-primary);
		font-weight: 500;
	}

	.queue-item-remove {
		width: 20px;
		height: 20px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
	}

	.queue-item-remove:hover {
		background: var(--color-error);
		color: white;
	}

	.queue-item-retry {
		width: 28px;
		height: 28px;
		border: none;
		background: var(--color-warning);
		color: white;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition: background 0.2s;
	}

	.queue-item-retry:hover {
		background: var(--color-primary);
	}

	.queue-item-actions {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.queue-item-dismiss {
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition: background 0.2s, color 0.2s;
	}

	.queue-item-dismiss:hover {
		background: var(--color-error);
		color: white;
	}

	.queue-item-error {
		padding: 0.25rem 0.5rem;
		margin-top: 0.25rem;
		background: rgba(239, 68, 68, 0.1);
		border-radius: var(--radius-sm);
	}

	.queue-item-error .error-text {
		font-size: 0.75rem;
		color: var(--color-error);
		word-break: break-word;
	}

	.queue-item-progress {
		height: 3px;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.queue-item-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.queue-stat {
		white-space: nowrap;
	}

	.queue-stat.bytes {
		flex-basis: 100%;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.queue-stat.retry {
		color: var(--color-warning);
	}

	.queue-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.queue-progress-summary {
		flex: 1;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.queue-progress-summary .wake-lock-indicator {
		display: inline-block;
		font-size: 0.625rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.queue-progress-summary .progress-bar {
		margin-top: 0.25rem;
		margin-bottom: 0;
	}

	.queue-complete {
		text-align: center;
		padding: 0.5rem;
	}

	.queue-complete-msg {
		font-weight: 500;
		margin-bottom: 0.5rem;
	}

	.queue-complete-msg.success {
		color: var(--color-success);
	}

	.queue-complete-msg.error {
		color: var(--color-error);
	}

	.queue-complete-msg.partial {
		color: var(--color-warning);
	}

	.queue-complete-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
	}

	.queue-complete-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
	}

	.add-more-label {
		display: inline-block;
		cursor: pointer;
	}

	.add-more-label .file-input {
		display: none;
	}

	/* Mobile */
	@media (max-width: 640px) {
		.drop-zone {
			padding: 1.5rem;
		}

		.upload-controls {
			padding: 1rem;
		}

		.file-info {
			flex-wrap: wrap;
		}

		.progress-stats {
			gap: 0.5rem;
		}

		.action-buttons {
			flex-direction: column;
		}

		.btn-primary,
		.btn-secondary,
		.btn-danger {
			width: 100%;
			text-align: center;
		}

		/* Queue item mobile optimizations */
		.queue-item {
			padding: 0.625rem;
		}

		.queue-item-info {
			gap: 0.375rem;
		}

		.queue-thumb,
		.queue-icon {
			width: 28px;
			height: 28px;
			flex-shrink: 0;
		}

		.queue-item-name {
			font-size: 0.8125rem;
		}

		.queue-item-size {
			font-size: 0.6875rem;
		}

		.queue-item-stats {
			display: grid;
			grid-template-columns: 1fr auto auto;
			gap: 0.25rem 0.5rem;
			align-items: center;
		}

		.queue-stat.bytes {
			grid-column: 1 / -1;
			font-size: 0.6875rem;
		}

		.queue-stat.speed,
		.queue-stat.eta {
			font-size: 0.625rem;
		}

		.queue-stat.retry {
			grid-column: 3;
			font-size: 0.625rem;
		}

		/* Queue header mobile */
		.queue-header {
			flex-wrap: wrap;
			gap: 0.5rem;
		}

		.queue-count {
			font-size: 0.875rem;
		}

		.add-more-btn {
			font-size: 0.8125rem;
		}

		/* Queue actions mobile */
		.queue-actions {
			flex-direction: column;
			gap: 0.5rem;
		}

		.queue-progress-summary {
			width: 100%;
			font-size: 0.8125rem;
		}

		.queue-actions .btn-primary,
		.queue-actions .btn-secondary,
		.queue-actions .btn-danger {
			width: 100%;
			justify-content: center;
		}

		/* Queue complete mobile */
		.queue-complete-actions {
			flex-direction: column;
			gap: 0.5rem;
		}

		.queue-complete-actions .btn-secondary {
			width: 100%;
		}
	}
</style>
