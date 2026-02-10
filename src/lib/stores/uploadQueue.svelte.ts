import type { UploadProgress, UploadResult } from '$lib/upload';

export type UploadStateType = 'idle' | 'preparing' | 'uploading' | 'paused' | 'completing' | 'completed' | 'error';

export interface QueuedFile {
	id: string; // Unique ID for reactive tracking
	file: File;
	state: UploadStateType;
	progress: UploadProgress | null;
	error: string | null;
	result: UploadResult | null;
	sessionId: string | null;
}

export interface UploadQueueState {
	files: QueuedFile[];
	allResults: UploadResult[];
	currentUploadIndex: number;
}

/**
 * Upload Queue Store
 * 
 * Persists upload queue state across component unmount/remount cycles.
 * Each milestone has its own queue state keyed by milestoneId.
 */
class UploadQueueStore {
	private queues = $state<Map<string, UploadQueueState>>(new Map());

	/**
	 * Get queue state for a milestone (creates if needed as side effect)
	 * For derived access, use getQueueReadonly which doesn't mutate
	 */
	getQueue(milestoneId: string): UploadQueueState {
		let queue = this.queues.get(milestoneId);
		if (!queue) {
			queue = {
				files: [],
				allResults: [],
				currentUploadIndex: -1
			};
			// Create new Map to trigger reactivity
			const newQueues = new Map(this.queues);
			newQueues.set(milestoneId, queue);
			this.queues = newQueues;
		}
		return queue;
	}

	/**
	 * Get current queue files for a milestone (for reactive reads)
	 */
	getFiles(milestoneId: string): QueuedFile[] {
		return this.queues.get(milestoneId)?.files ?? [];
	}

	/**
	 * Get current upload index for a milestone
	 */
	getCurrentIndex(milestoneId: string): number {
		return this.queues.get(milestoneId)?.currentUploadIndex ?? -1;
	}

	/**
	 * Get all results for a milestone
	 */
	getResults(milestoneId: string): UploadResult[] {
		return this.queues.get(milestoneId)?.allResults ?? [];
	}

	/**
	 * Check if a milestone has any queue state
	 */
	hasQueue(milestoneId: string): boolean {
		const queue = this.queues.get(milestoneId);
		return !!queue && queue.files.length > 0;
	}

	/**
	 * Check if a milestone has active uploads
	 */
	hasActiveUploads(milestoneId: string): boolean {
		const queue = this.queues.get(milestoneId);
		if (!queue) return false;
		return queue.files.some(f => 
			f.state === 'uploading' || f.state === 'preparing' || f.state === 'completing' || f.state === 'paused'
		);
	}

	/**
	 * Check if any milestone has active uploads
	 */
	hasAnyActiveUploads(): boolean {
		for (const [, queue] of this.queues) {
			if (queue.files.some(f => 
				f.state === 'uploading' || f.state === 'preparing' || f.state === 'completing' || f.state === 'paused'
			)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Add files to a milestone's queue
	 */
	addFiles(milestoneId: string, files: QueuedFile[]): void {
		const queue = this.queues.get(milestoneId);
		const existingFiles = queue?.files ?? [];
		const newQueue = {
			files: [...existingFiles, ...files],
			allResults: queue?.allResults ?? [],
			currentUploadIndex: queue?.currentUploadIndex ?? -1
		};
		const newQueues = new Map(this.queues);
		newQueues.set(milestoneId, newQueue);
		this.queues = newQueues;
	}

	/**
	 * Update a specific file in a milestone's queue
	 */
	updateFile(milestoneId: string, fileId: string, updates: Partial<QueuedFile>): void {
		const queue = this.queues.get(milestoneId);
		if (!queue) return;

		const fileIndex = queue.files.findIndex(f => f.id === fileId);
		if (fileIndex === -1) return;

		// Create new array with updated file to trigger reactivity
		const newFiles = [...queue.files];
		newFiles[fileIndex] = { ...queue.files[fileIndex], ...updates };
		
		// Create new queue object with new files array
		const newQueue = { ...queue, files: newFiles };
		
		// Trigger reactivity by creating new Map with new queue object
		const newQueues = new Map(this.queues);
		newQueues.set(milestoneId, newQueue);
		this.queues = newQueues;
	}

	/**
	 * Remove a file from a milestone's queue
	 */
	removeFile(milestoneId: string, fileId: string): void {
		const queue = this.queues.get(milestoneId);
		if (!queue) return;

		const newQueue = { ...queue, files: queue.files.filter(f => f.id !== fileId) };
		const newQueues = new Map(this.queues);
		newQueues.set(milestoneId, newQueue);
		this.queues = newQueues;
	}

	/**
	 * Clear completed files from a milestone's queue
	 */
	clearCompleted(milestoneId: string): void {
		const queue = this.queues.get(milestoneId);
		if (!queue) return;

		const newQueue = { ...queue, files: queue.files.filter(f => f.state !== 'completed') };
		const newQueues = new Map(this.queues);
		newQueues.set(milestoneId, newQueue);
		this.queues = newQueues;
	}

	/**
	 * Reset a milestone's queue entirely
	 */
	resetQueue(milestoneId: string): void {
		this.queues.delete(milestoneId);
		this.queues = new Map(this.queues);
	}

	/**
	 * Add a result to a milestone's results
	 */
	addResult(milestoneId: string, result: UploadResult): void {
		const queue = this.queues.get(milestoneId);
		if (!queue) {
			this.getQueue(milestoneId); // Ensure queue exists
			return this.addResult(milestoneId, result);
		}
		const newQueue = { ...queue, allResults: [...queue.allResults, result] };
		const newQueues = new Map(this.queues);
		newQueues.set(milestoneId, newQueue);
		this.queues = newQueues;
	}

	/**
	 * Clear results for a milestone (for starting new upload batch)
	 */
	clearResults(milestoneId: string): void {
		const queue = this.queues.get(milestoneId);
		if (!queue) return;
		const newQueue = { ...queue, allResults: [] };
		const newQueues = new Map(this.queues);
		newQueues.set(milestoneId, newQueue);
		this.queues = newQueues;
	}

	/**
	 * Set current upload index
	 */
	setCurrentIndex(milestoneId: string, index: number): void {
		const queue = this.queues.get(milestoneId);
		if (!queue) return;
		const newQueue = { ...queue, currentUploadIndex: index };
		const newQueues = new Map(this.queues);
		newQueues.set(milestoneId, newQueue);
		this.queues = newQueues;
	}

	/**
	 * Get derived stats for a queue
	 */
	getStats(milestoneId: string): {
		total: number;
		uploading: number;
		completed: number;
		failed: number;
		pending: number;
		progress: number;
	} {
		const queue = this.queues.get(milestoneId);
		if (!queue || queue.files.length === 0) {
			return { total: 0, uploading: 0, completed: 0, failed: 0, pending: 0, progress: 0 };
		}

		const files = queue.files;
		const uploading = files.filter(f => f.state === 'uploading' || f.state === 'preparing').length;
		const completed = files.filter(f => f.state === 'completed').length;
		const failed = files.filter(f => f.state === 'error').length;
		const pending = files.filter(f => f.state === 'idle').length;
		const progress = files.reduce((sum, f) => 
			sum + (f.progress?.progress ?? (f.state === 'completed' ? 100 : 0)), 0
		) / files.length;

		return { total: files.length, uploading, completed, failed, pending, progress };
	}

	/**
	 * Check if queue is completed (all files done or failed)
	 */
	isQueueCompleted(milestoneId: string): boolean {
		const queue = this.queues.get(milestoneId);
		if (!queue || queue.files.length === 0) return false;
		return queue.files.every(f => f.state === 'completed' || f.state === 'error');
	}

	/**
	 * Generate unique file ID
	 */
	generateFileId(): string {
		return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
	}
}

export const uploadQueueStore = new UploadQueueStore();
