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

	interface Props {
		milestoneId?: string;
		accept?: string;
		maxSize?: number; // in bytes
		chunkSize?: number;
		concurrency?: number;
		multiple?: boolean; // Allow multiple files
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
		onUploadComplete,
		onUploadError,
		onAllUploadsComplete
	}: Props = $props();

	// State
	type UploadStateType = 'idle' | 'preparing' | 'uploading' | 'paused' | 'completing' | 'completed' | 'error';
	
	// File queue for multiple uploads
	interface QueuedFile {
		file: File;
		state: UploadStateType;
		progress: UploadProgress | null;
		error: string | null;
		result: UploadResult | null;
		abortController: AbortController | null;
	}
	
	let fileQueue = $state<QueuedFile[]>([]);
	let currentUploadIndex = $state<number>(-1);
	let allResults = $state<UploadResult[]>([]);
	
	// Legacy single-file state (for backward compatibility)
	let uploadState = $state<UploadStateType>('idle');
	let selectedFile = $state<File | null>(null);
	let progress = $state<UploadProgress | null>(null);
	let error = $state<string | null>(null);
	let result = $state<UploadResult | null>(null);
	let abortController = $state<AbortController | null>(null);
	let sessionId = $state<string | null>(null);
	let isDragging = $state(false);
	
	// Derived state for queue
	let isQueueMode = $derived(fileQueue.length > 0);
	let queueCompleted = $derived(fileQueue.length > 0 && fileQueue.every(f => f.state === 'completed' || f.state === 'error'));
	let uploadingCount = $derived(fileQueue.filter(f => f.state === 'uploading' || f.state === 'preparing').length);
	let completedCount = $derived(fileQueue.filter(f => f.state === 'completed').length);
	let totalQueueProgress = $derived(
		fileQueue.length > 0
			? fileQueue.reduce((sum, f) => sum + (f.progress?.progress ?? (f.state === 'completed' ? 100 : 0)), 0) / fileQueue.length
			: 0
	);

	// Derived state
	let progressPercent = $derived(progress?.progress ?? 0);
	let canPause = $derived(uploadState === 'uploading');
	let canResume = $derived(uploadState === 'paused');
	let canCancel = $derived(uploadState === 'uploading' || uploadState === 'paused' || uploadState === 'preparing');

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
		// Reset queue
		fileQueue = [];
		allResults = [];
		currentUploadIndex = -1;
		error = null;
		
		for (const file of files) {
			const validationError = validateFile(file);
			fileQueue.push({
				file,
				state: validationError ? 'error' : 'idle',
				progress: null,
				error: validationError,
				result: null,
				abortController: null
			});
		}
	}
	
	function addMoreFiles(files: File[]) {
		for (const file of files) {
			const validationError = validateFile(file);
			fileQueue.push({
				file,
				state: validationError ? 'error' : 'idle',
				progress: null,
				error: validationError,
				result: null,
				abortController: null
			});
		}
	}
	
	function removeFromQueue(index: number) {
		const item = fileQueue[index];
		if (item.abortController) {
			item.abortController.abort();
		}
		fileQueue = fileQueue.filter((_, i) => i !== index);
		// Adjust current index if needed
		if (currentUploadIndex >= index && currentUploadIndex > 0) {
			currentUploadIndex--;
		}
	}

	let isPausing = $state(false);

	async function startUpload() {
		if (!selectedFile) return;

		uploadState = 'preparing';
		error = null;
		isPausing = false;
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
				onError: (err, chunkIndex) => {
					console.error(`Chunk ${chunkIndex} error:`, err);
				}
			});

			uploadState = 'completed';
			result = uploadResult;
			onUploadComplete?.(uploadResult);
			onAllUploadsComplete?.([uploadResult]);
		} catch (err) {
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
		fileQueue = [];
		allResults = [];
		currentUploadIndex = -1;
		error = null;
	}
	
	function resetAll() {
		reset();
		resetQueue();
	}
	
	// Queue upload functions
	async function startQueueUpload() {
		if (fileQueue.length === 0) return;
		
		allResults = [];
		
		for (let i = 0; i < fileQueue.length; i++) {
			const item = fileQueue[i];
			if (item.state === 'error' || item.state === 'completed') continue; // Skip files with validation errors or already completed
			
			currentUploadIndex = i;
			item.state = 'preparing';
			item.abortController = new AbortController();
			item.error = null;
			
			try {
				item.state = 'uploading';
				
				const uploadResult = await uploadFile(item.file, {
					milestoneId,
					chunkSize,
					concurrency,
					signal: item.abortController.signal,
					onProgress: (p) => {
						item.progress = p;
					},
					onError: (err, chunkIndex) => {
						console.error(`Chunk ${chunkIndex} error:`, err);
					}
				});
				
				item.state = 'completed';
				item.result = uploadResult;
				allResults.push(uploadResult);
				onUploadComplete?.(uploadResult);
			} catch (err) {
				if ((err as Error).message === 'Upload cancelled') {
					item.state = 'idle';
				} else {
					item.state = 'error';
					item.error = (err as Error).message;
					onUploadError?.(err as Error);
				}
			} finally {
				item.abortController = null;
			}
		}
		
		currentUploadIndex = -1;
		if (allResults.length > 0) {
			onAllUploadsComplete?.(allResults);
		}
	}
	
	async function cancelQueueUploads() {
		for (const item of fileQueue) {
			if (item.abortController) {
				item.abortController.abort();
			}
		}
		resetQueue();
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
				{#each fileQueue as item, index (index)}
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
								<span class="queue-item-status error" title={item.error ?? ''}>⚠️</span>
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
						{/if}
					</div>
				{/each}
			</div>
			
			{#if queueCompleted}
				<div class="queue-complete">
					<p class="queue-complete-msg">✓ {completedCount} of {fileQueue.length} files uploaded</p>
					<button type="button" class="btn-secondary" onclick={resetQueue}>Upload More Files</button>
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
							<span>Uploading... {completedCount}/{fileQueue.length}</span>
							<div class="progress-bar">
								<div class="progress-fill" style="width: {totalQueueProgress}%"></div>
							</div>
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
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={result.url} controls class="preview-video"></video>
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

			{#if progress && uploadState !== 'idle'}}
				<!-- Progress Display -->
				<div class="progress-container">
					<div class="progress-bar">
						<div
							class="progress-fill"
							class:paused={uploadState === 'paused'}
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
					<div class="chunk-info">
						{progress.uploadedChunks.length} chunks uploaded
					</div>
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

	.preview-image,
	.preview-video {
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

	.queue-item-status.error {
		color: var(--color-error);
		cursor: help;
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

	.queue-item-progress {
		height: 3px;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-full);
		overflow: hidden;
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

	.queue-progress-summary .progress-bar {
		margin-top: 0.25rem;
		margin-bottom: 0;
	}

	.queue-complete {
		text-align: center;
		padding: 0.5rem;
	}

	.queue-complete-msg {
		color: var(--color-success);
		font-weight: 500;
		margin-bottom: 0.5rem;
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
	}
</style>
