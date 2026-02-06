<script lang="ts">
	type MediaItem = {
		type: 'image' | 'video';
		url: string;
		thumbnailUrl?: string;
	};

	type Props = {
		images?: string[];
		media?: MediaItem[];
		currentIndex?: number;
		open?: boolean;
		onclose?: () => void;
	};

	let { images = [], media = [], currentIndex = 0, open = false, onclose }: Props = $props();

	// Support both legacy `images` prop and new `media` prop
	let mediaItems = $derived<MediaItem[]>(
		media.length > 0
			? media
			: images.map(url => ({ type: 'image' as const, url }))
	);

	let indexOffset = $state(0);
	let activeIndex = $derived(
		mediaItems.length > 0
			? ((currentIndex + indexOffset) % mediaItems.length + mediaItems.length) % mediaItems.length
			: 0
	);
	let currentItem = $derived(mediaItems[activeIndex]);

	// Reset offset when currentIndex changes from parent
	$effect(() => {
		// When the parent changes currentIndex, reset our offset
		void currentIndex;
		indexOffset = 0;
	});

	$effect(() => {
		if (open) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		
		switch (e.key) {
			case 'Escape':
				onclose?.();
				break;
			case 'ArrowLeft':
				prev();
				break;
			case 'ArrowRight':
				next();
				break;
		}
	}

	function prev() {
		indexOffset = indexOffset - 1;
	}

	function next() {
		indexOffset = indexOffset + 1;
	}

	function goTo(index: number) {
		indexOffset = index - currentIndex;
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onclose?.();
		}
	}
	
	// Touch swipe handling for mobile
	let touchStartX = $state(0);
	let touchStartY = $state(0);
	let touchDeltaX = $state(0);
	let isSwiping = $state(false);
	const SWIPE_THRESHOLD = 50; // minimum distance for a swipe
	const SWIPE_VELOCITY_THRESHOLD = 0.3; // minimum velocity for a quick swipe
	let touchStartTime = $state(0);
	
	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		
		const touch = e.touches[0];
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchDeltaX = 0;
		isSwiping = false;
		touchStartTime = Date.now();
	}
	
	function handleTouchMove(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		
		const touch = e.touches[0];
		const deltaX = touch.clientX - touchStartX;
		const deltaY = touch.clientY - touchStartY;
		
		// Only start swiping if horizontal movement is greater than vertical
		if (!isSwiping && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
			isSwiping = true;
		}
		
		if (isSwiping) {
			e.preventDefault(); // Prevent scrolling while swiping
			touchDeltaX = deltaX;
		}
	}
	
	function handleTouchEnd(e: TouchEvent) {
		if (!isSwiping) {
			touchDeltaX = 0;
			return;
		}
		
		const elapsed = Date.now() - touchStartTime;
		const velocity = Math.abs(touchDeltaX) / elapsed;
		
		// Determine if it's a valid swipe based on distance or velocity
		const isValidSwipe = Math.abs(touchDeltaX) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD;
		
		if (isValidSwipe && mediaItems.length > 1) {
			if (touchDeltaX > 0) {
				prev(); // Swipe right = previous
			} else {
				next(); // Swipe left = next
			}
		}
		
		// Reset
		touchDeltaX = 0;
		isSwiping = false;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="lightbox-overlay"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && onclose?.()}
		role="dialog"
		aria-modal="true"
		aria-label="Image viewer"
		tabindex="-1"
	>
		<button class="close-button" onclick={onclose} aria-label="Close lightbox">
			<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<line x1="18" y1="6" x2="6" y2="18"></line>
				<line x1="6" y1="6" x2="18" y2="18"></line>
			</svg>
		</button>

		<div 
			class="lightbox-content"
			role="region"
			aria-label="Media viewer with swipe navigation"
			ontouchstart={handleTouchStart}
			ontouchmove={handleTouchMove}
			ontouchend={handleTouchEnd}
			style="transform: translateX({touchDeltaX}px); transition: {isSwiping ? 'none' : 'transform 0.2s ease-out'};"
		>
			{#if mediaItems.length > 1}
				<button class="nav-button prev" onclick={prev} aria-label="Previous">
					<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="15 18 9 12 15 6"></polyline>
					</svg>
				</button>
			{/if}

			{#if currentItem?.type === 'video'}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					src={currentItem.url}
					class="lightbox-video"
					controls
					autoplay
					playsinline
				></video>
			{:else if currentItem}
				<img src={currentItem.url} alt="" class="lightbox-image" />
			{/if}

			{#if mediaItems.length > 1}
				<button class="nav-button next" onclick={next} aria-label="Next">
					<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="9 18 15 12 9 6"></polyline>
					</svg>
				</button>
			{/if}
		</div>

		{#if mediaItems.length > 1}
			<div class="lightbox-counter">
				{activeIndex + 1} / {mediaItems.length}
			</div>

			<div class="lightbox-thumbnails">
				{#each mediaItems as item, i (i)}
					<button
						class="thumbnail-button"
						class:active={i === activeIndex}
						class:is-video={item.type === 'video'}
						onclick={() => goTo(i)}
						aria-label="View {item.type} {i + 1}"
					>
						{#if item.type === 'video' && item.thumbnailUrl}
							<img src={item.thumbnailUrl} alt="" />
							<span class="video-indicator">▶</span>
						{:else if item.type === 'video'}
							<div class="video-placeholder">
								<span>▶</span>
							</div>
						{:else}
							<img src={item.thumbnailUrl || item.url} alt="" />
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.lightbox-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: rgba(0, 0, 0, 0.95);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		padding: 1rem;
	}

	.close-button {
		position: absolute;
		top: 1rem;
		right: 1rem;
		background: none;
		border: none;
		color: white;
		cursor: pointer;
		padding: 0.5rem;
		border-radius: var(--radius-md);
		transition: background-color 0.2s;
		z-index: 1001;
	}

	.close-button:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.lightbox-content {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		max-width: 100%;
		max-height: calc(100vh - 150px);
		flex: 1;
	}

	.lightbox-image,
	.lightbox-video {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: var(--radius-md);
	}

	.lightbox-video {
		background: black;
	}

	.nav-button {
		background: rgba(255, 255, 255, 0.1);
		border: none;
		color: white;
		cursor: pointer;
		padding: 0.75rem;
		border-radius: var(--radius-full);
		transition: background-color 0.2s;
		flex-shrink: 0;
	}

	.nav-button:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.lightbox-counter {
		color: white;
		font-size: 0.875rem;
		margin-top: 1rem;
	}

	.lightbox-thumbnails {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
		overflow-x: auto;
		max-width: 100%;
		padding: 0.25rem;
	}

	.thumbnail-button {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		padding: 0;
		border: 2px solid transparent;
		border-radius: var(--radius-sm);
		overflow: hidden;
		cursor: pointer;
		opacity: 0.6;
		transition: opacity 0.2s, border-color 0.2s;
		background: none;
	}

	.thumbnail-button:hover {
		opacity: 0.8;
	}

	.thumbnail-button.active {
		opacity: 1;
		border-color: white;
	}

	.thumbnail-button img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumbnail-button.is-video {
		position: relative;
	}

	.video-indicator {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.3);
		color: white;
		font-size: 0.75rem;
	}

	.video-placeholder {
		width: 100%;
		height: 100%;
		background: var(--color-border, #333);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-size: 0.875rem;
	}

	@media (max-width: 640px) {
		.nav-button {
			display: none; /* Hide nav buttons on mobile, use swipe instead */
		}

		.lightbox-thumbnails {
			display: none;
		}
		
		.lightbox-content {
			width: 100%;
			touch-action: pan-y pinch-zoom; /* Allow vertical scroll and zoom, but handle horizontal ourselves */
		}
		
		.lightbox-counter {
			font-size: 1rem;
		}
		
		/* Swipe hint on mobile */
		.lightbox-overlay::after {
			content: '';
			position: absolute;
			bottom: 80px;
			left: 50%;
			transform: translateX(-50%);
			width: 40px;
			height: 4px;
			background: rgba(255, 255, 255, 0.3);
			border-radius: 2px;
		}
	}
</style>
