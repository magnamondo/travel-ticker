<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		url: string;
		thumbnailUrl?: string | null;
		videoJobId?: string | null;
		playable?: boolean; // When true, clicking shows an inline video player
		onJobComplete?: (result: { resultUrl: string; thumbnailUrl?: string; duration?: number }) => void;
	}

	let { url, thumbnailUrl, videoJobId, playable = false, onJobComplete }: Props = $props();

	let jobStatus = $state<'pending' | 'processing' | 'completed' | 'failed' | null>(null);
	let jobProgress = $state(0);
	let jobError = $state<string | null>(null);
	let finalThumbnailUrl = $state<string | null | undefined>(undefined);
	let finalVideoUrl = $state<string | undefined>(undefined);
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let showPlayer = $state(false);

	// Update final URLs when props change
	$effect(() => {
		if (thumbnailUrl !== undefined) finalThumbnailUrl = thumbnailUrl;
	});
	$effect(() => {
		if (url !== undefined) finalVideoUrl = url;
	});

	// Derive the display state
	let isProcessing = $derived(jobStatus === 'pending' || jobStatus === 'processing');
	let isReady = $derived(!videoJobId || jobStatus === 'completed');
	let hasFailed = $derived(jobStatus === 'failed');

	function handleClick() {
		if (playable && isReady && !hasFailed) {
			showPlayer = true;
		}
	}

	async function pollJobStatus() {
		if (!videoJobId) return;

		try {
			const res = await fetch(`/api/video-status/${videoJobId}`);
			if (!res.ok) {
				// Job might have been deleted
				if (pollInterval) {
					clearInterval(pollInterval);
					pollInterval = null;
				}
				return;
			}

			const data = await res.json();
			jobStatus = data.status;
			jobProgress = data.progress || 0;
			jobError = data.error || null;

			if (data.status === 'completed') {
				// Update with final URLs
				if (data.resultUrl) finalVideoUrl = data.resultUrl;
				if (data.thumbnailUrl) finalThumbnailUrl = data.thumbnailUrl;
				
				// Stop polling
				if (pollInterval) {
					clearInterval(pollInterval);
					pollInterval = null;
				}

				// Notify parent
				onJobComplete?.({
					resultUrl: data.resultUrl || url,
					thumbnailUrl: data.thumbnailUrl,
					duration: data.duration
				});
			} else if (data.status === 'failed') {
				// Stop polling on failure
				if (pollInterval) {
					clearInterval(pollInterval);
					pollInterval = null;
				}
			}
		} catch {
			// Network error, keep polling
		}
	}

	onMount(() => {
		if (videoJobId) {
			// Start polling immediately
			pollJobStatus();
			pollInterval = setInterval(pollJobStatus, 2000);
		}

		return () => {
			if (pollInterval) {
				clearInterval(pollInterval);
			}
		};
	});
</script>

{#if showPlayer && finalVideoUrl}
	<div class="video-player-container">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video src={finalVideoUrl} controls autoplay class="video-player"></video>
		<button type="button" class="close-player" onclick={() => showPlayer = false}>×</button>
	</div>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		class="video-thumbnail" 
		class:processing={isProcessing} 
		class:failed={hasFailed}
		class:clickable={playable && isReady && !hasFailed}
		onclick={handleClick}
	>
		{#if finalThumbnailUrl}
			<img src={finalThumbnailUrl} alt="" class="thumbnail-img" />
		{:else}
			<div class="placeholder">
				<span class="video-icon">🎬</span>
			</div>
		{/if}

		{#if isProcessing}
			<div class="processing-overlay">
				<div class="spinner"></div>
				<span class="progress-text">
					{#if jobStatus === 'pending'}
						Queued...
					{:else}
						{jobProgress}%
					{/if}
				</span>
			</div>
		{:else if hasFailed}
			<div class="error-overlay">
				<span class="error-icon">⚠️</span>
				<span class="error-text" title={jobError || 'Processing failed'}>Failed</span>
			</div>
		{:else}
			<div class="play-overlay">
				<span class="play-icon">▶</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.video-thumbnail {
		position: relative;
		width: 100%;
		height: 100%;
		background: var(--color-bg-elevated, #1a1a1a);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.thumbnail-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	.video-icon {
		font-size: 2rem;
		opacity: 0.5;
	}

	.processing-overlay,
	.error-overlay,
	.play-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
	}

	.processing-overlay {
		background: rgba(0, 0, 0, 0.7);
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.progress-text {
		font-size: 0.625rem;
		color: white;
		font-weight: 500;
	}

	.error-overlay {
		background: rgba(239, 68, 68, 0.8);
	}

	.error-icon {
		font-size: 1.25rem;
	}

	.error-text {
		font-size: 0.625rem;
		color: white;
		font-weight: 500;
	}

	.play-overlay {
		background: rgba(0, 0, 0, 0.3);
		opacity: 0;
		transition: opacity 0.15s;
	}

	.video-thumbnail:hover .play-overlay {
		opacity: 1;
	}

	.play-icon {
		width: 32px;
		height: 32px;
		background: rgba(255, 255, 255, 0.9);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.875rem;
		padding-left: 3px;
		color: #000;
	}

	.video-thumbnail.processing .thumbnail-img {
		filter: blur(2px);
	}

	.video-thumbnail.clickable {
		cursor: pointer;
	}

	.video-player-container {
		position: relative;
		width: 100%;
		max-height: 400px;
		background: #000;
		border-radius: var(--radius-md, 8px);
		overflow: hidden;
	}

	.video-player {
		width: 100%;
		max-height: 400px;
		display: block;
	}

	.close-player {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		border: none;
		font-size: 1.25rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		transition: background 0.15s;
	}

	.close-player:hover {
		background: rgba(0, 0, 0, 0.8);
	}
</style>
