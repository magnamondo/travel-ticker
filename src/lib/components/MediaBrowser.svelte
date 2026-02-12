<script lang="ts">
	type MediaItem = {
		id: string;
		milestoneId: string;
		type: 'image' | 'video';
		url: string;
		thumbnailUrl: string | null;
		caption: string | null;
		duration: number | null;
		createdAt: Date;
		milestoneTitle: string | null;
	};

	interface Props {
		open: boolean;
		onselect: (media: MediaItem) => void;
		onclose: () => void;
	}

	let { open, onselect, onclose }: Props = $props();

	let media = $state<MediaItem[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let filter = $state<'all' | 'images' | 'videos'>('all');
	let searchQuery = $state('');

	$effect(() => {
		if (open) {
			document.body.style.overflow = 'hidden';
			loadMedia();
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	});

	async function loadMedia() {
		loading = true;
		error = null;
		try {
			const response = await fetch('/api/media/browse');
			if (!response.ok) {
				throw new Error('Failed to load media');
			}
			const data = await response.json();
			media = data.media;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load media';
		} finally {
			loading = false;
		}
	}

	let filteredMedia = $derived.by(() => {
		let result = media;
		
		// Apply type filter
		if (filter === 'images') {
			result = result.filter(m => m.type === 'image');
		} else if (filter === 'videos') {
			result = result.filter(m => m.type === 'video');
		}
		
		// Apply search filter
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(m => 
				m.milestoneTitle?.toLowerCase().includes(query) ||
				m.caption?.toLowerCase().includes(query)
			);
		}
		
		return result;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			onclose();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onclose();
		}
	}

	function selectMedia(item: MediaItem) {
		onselect(item);
		onclose();
	}

	function formatDuration(seconds: number | null | undefined) {
		if (seconds === null || seconds === undefined) return '';
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `0:${secs.toString().padStart(2, '0')}`;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="browser-overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby="browser-title"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div class="browser-modal">
			<div class="browser-header">
				<h2 id="browser-title">Select Media</h2>
				<button type="button" class="btn-close" onclick={onclose} aria-label="Close">×</button>
			</div>

			<div class="browser-toolbar">
				<div class="filter-tabs">
					<button
						type="button"
						class="filter-tab"
						class:active={filter === 'all'}
						onclick={() => filter = 'all'}
					>
						All
					</button>
					<button
						type="button"
						class="filter-tab"
						class:active={filter === 'images'}
						onclick={() => filter = 'images'}
					>
						🖼️ Images
					</button>
					<button
						type="button"
						class="filter-tab"
						class:active={filter === 'videos'}
						onclick={() => filter = 'videos'}
					>
						🎬 Videos
					</button>
				</div>
				<input
					type="text"
					class="search-input"
					placeholder="Search by caption or entry..."
					bind:value={searchQuery}
				/>
			</div>

			<div class="browser-content">
				{#if loading}
					<div class="loading-state">
						<div class="spinner"></div>
						<p>Loading media...</p>
					</div>
				{:else if error}
					<div class="error-state">
						<p>{error}</p>
						<button type="button" class="btn-retry" onclick={loadMedia}>Try Again</button>
					</div>
				{:else if filteredMedia.length === 0}
					<div class="empty-state">
						<p>No media found</p>
					</div>
				{:else}
					<div class="media-grid">
						{#each filteredMedia as item (item.id)}
							<button
								type="button"
								class="media-card"
								onclick={() => selectMedia(item)}
							>
								<div class="media-thumbnail">
									{#if item.type === 'video'}
										{#if item.thumbnailUrl}
											<img src={item.thumbnailUrl} alt="" />
										{:else}
											<div class="video-placeholder">🎬</div>
										{/if}
										<span class="play-badge">▶</span>
										{#if item.duration}
											<span class="duration-badge">{formatDuration(item.duration)}</span>
										{/if}
									{:else}
										<img src={item.thumbnailUrl || item.url} alt="" />
									{/if}
								</div>
								<div class="media-info">
									{#if item.milestoneTitle}
										<span class="media-source">{item.milestoneTitle}</span>
									{/if}
									{#if item.caption}
										<span class="media-caption">{item.caption}</span>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.browser-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.browser-modal {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-lg);
		width: 100%;
		max-width: 900px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		animation: slideUp 0.2s ease-out;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.browser-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.browser-header h2 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.btn-close {
		background: none;
		border: none;
		font-size: 1.5rem;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0.25rem;
		line-height: 1;
	}

	.btn-close:hover {
		color: var(--color-text);
	}

	.browser-toolbar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--color-border);
		flex-wrap: wrap;
	}

	.filter-tabs {
		display: flex;
		gap: 0.5rem;
	}

	.filter-tab {
		padding: 0.5rem 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.filter-tab:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.filter-tab.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}

	.search-input {
		flex: 1;
		min-width: 200px;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.browser-content {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem;
	}

	.loading-state,
	.error-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem;
		color: var(--color-text-muted);
		gap: 1rem;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.btn-retry {
		padding: 0.5rem 1rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
	}

	.media-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 1rem;
	}

	.media-card {
		background: var(--color-bg-secondary);
		border: 2px solid transparent;
		border-radius: var(--radius-md);
		overflow: hidden;
		cursor: pointer;
		transition: all 0.2s ease;
		padding: 0;
		text-align: left;
	}

	.media-card:hover {
		border-color: var(--color-primary);
		transform: translateY(-2px);
	}

	.media-thumbnail {
		position: relative;
		aspect-ratio: 1;
		overflow: hidden;
		background: var(--color-bg);
	}

	.media-thumbnail img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.video-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2.5rem;
		background: var(--color-bg);
	}

	.play-badge {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: rgba(0, 0, 0, 0.6);
		color: white;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
	}

	.duration-badge {
		position: absolute;
		bottom: 4px;
		right: 4px;
		background: rgba(0, 0, 0, 0.75);
		color: white;
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 0.75rem;
	}

	.media-info {
		padding: 0.5rem;
	}

	.media-source {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.media-caption {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-top: 0.125rem;
	}

	/* Mobile styles */
	@media (max-width: 768px) {
		.browser-modal {
			max-height: 95vh;
		}

		.browser-toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.filter-tabs {
			justify-content: center;
		}

		.search-input {
			width: 100%;
		}

		.media-grid {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
			gap: 0.75rem;
		}
	}
</style>
