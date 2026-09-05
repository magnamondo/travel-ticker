<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';

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

	// Image loading state (SvelteSet is reactive, so mutating it is enough)
	const loadedUrls = new SvelteSet<string>();
	let imageLoading = $derived(
		currentItem?.type === 'image' && !loadedUrls.has(currentItem.url)
	);

	function handleImageLoad(url: string) {
		loadedUrls.add(url);
	}

	// Preload adjacent images
	$effect(() => {
		if (!open || mediaItems.length <= 1) return;
		const indicesToPreload = [
			(activeIndex + 1) % mediaItems.length,
			(activeIndex - 1 + mediaItems.length) % mediaItems.length
		];
		for (const idx of indicesToPreload) {
			const item = mediaItems[idx];
			if (item?.type === 'image' && !loadedUrls.has(item.url)) {
				const img = new Image();
				img.onload = () => handleImageLoad(item.url);
				img.src = item.url;
			}
		}
	});

	// Reset offset when currentIndex changes from parent
	$effect(() => {
		// When the parent changes currentIndex, reset our offset
		void currentIndex;
		indexOffset = 0;
	});

	$effect(() => {
		if (open) {
			document.body.style.overflow = 'hidden';
			document.documentElement.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
			document.documentElement.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
			document.documentElement.style.overflow = '';
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
		resetZoom();
	}

	function next() {
		indexOffset = indexOffset + 1;
		resetZoom();
	}

	function goTo(index: number) {
		indexOffset = index - currentIndex;
		resetZoom();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onclose?.();
		}
	}
	
	// Zoom state for mobile pinch-to-zoom
	let zoomScale = $state(1);
	let zoomX = $state(0);
	let zoomY = $state(0);
	let isZoomed = $derived(zoomScale > 1.01);
	const MIN_ZOOM = 1;
	const MAX_ZOOM = 4;
	const ZOOM_SNAP_BACK = 1.1; // release below this and we snap back to 1x
	const DOUBLE_TAP_ZOOM = 2.5;
	let imageEl = $state<HTMLImageElement | null>(null);

	// Geometry of the image's layout box, captured when a gesture starts.
	// zoomX/zoomY are screen-space offsets applied *after* scaling, so the
	// layout centre is the on-screen centre minus the current offset.
	type ImageBox = { centerX: number; centerY: number; width: number; height: number };
	let gestureBox: ImageBox | null = null;

	function getImageBox(): ImageBox | null {
		if (!imageEl) return null;
		const rect = imageEl.getBoundingClientRect();
		return {
			centerX: rect.left + rect.width / 2 - zoomX,
			centerY: rect.top + rect.height / 2 - zoomY,
			width: imageEl.offsetWidth,
			height: imageEl.offsetHeight
		};
	}

	// Keep the scaled image from being dragged past its own edges
	function clampPan() {
		const box = gestureBox;
		if (!box) return;
		const boundX = Math.max(0, (box.width * zoomScale - box.width) / 2);
		const boundY = Math.max(0, (box.height * zoomScale - box.height) / 2);
		zoomX = Math.min(boundX, Math.max(-boundX, zoomX));
		zoomY = Math.min(boundY, Math.max(-boundY, zoomY));
	}
	
	// Reset zoom when changing images or closing
	function resetZoom() {
		zoomScale = 1;
		zoomX = 0;
		zoomY = 0;
		initialZoomX = 0;
		initialZoomY = 0;
		gestureBox = null;
	}
	
	// Reset zoom when lightbox closes
	$effect(() => {
		if (!open) {
			resetZoom();
		}
	});
	
	// Touch swipe handling for mobile
	let touchStartX = $state(0);
	let touchStartY = $state(0);
	let touchDeltaX = $state(0);
	let touchDeltaY = $state(0);
	let isSwiping = $state(false);
	let swipeDirection = $state<'horizontal' | 'vertical' | null>(null);
	const SWIPE_THRESHOLD = 50; // minimum distance for a swipe
	const SWIPE_VERTICAL_THRESHOLD = 100; // requires more distance to close
	const SWIPE_VELOCITY_THRESHOLD = 0.3; // minimum velocity for a quick swipe
	let touchStartTime = $state(0);
	
	// Pinch-to-zoom state
	let isPinching = $state(false);
	let initialPinchDistance = $state(0);
	let initialPinchScale = $state(1);
	let pinchCenterX = $state(0);
	let pinchCenterY = $state(0);
	
	// Pan state (when zoomed)
	let isPanning = $state(false);
	let panStartX = $state(0);
	let panStartY = $state(0);
	let initialZoomX = $state(0);
	let initialZoomY = $state(0);
	
	// Double tap detection
	let lastTapTime = $state(0);
	let lastTapX = $state(0);
	let lastTapY = $state(0);
	const DOUBLE_TAP_DELAY = 300;
	const DOUBLE_TAP_DISTANCE = 50;
	
	function getDistance(touch1: Touch, touch2: Touch): number {
		const dx = touch1.clientX - touch2.clientX;
		const dy = touch1.clientY - touch2.clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}
	
	function getMidpoint(touch1: Touch, touch2: Touch): { x: number; y: number } {
		return {
			x: (touch1.clientX + touch2.clientX) / 2,
			y: (touch1.clientY + touch2.clientY) / 2
		};
	}
	
	function startPinch(touch1: Touch, touch2: Touch) {
		isPinching = true;
		isSwiping = false;
		isPanning = false;
		swipeDirection = null;
		touchDeltaX = 0;
		touchDeltaY = 0;
		lastTapTime = 0; // a pinch is never half of a double tap
		gestureBox = getImageBox();
		// Guard against both fingers landing on the same point (distance 0 -> NaN scale)
		initialPinchDistance = Math.max(1, getDistance(touch1, touch2));
		initialPinchScale = zoomScale;
		initialZoomX = zoomX;
		initialZoomY = zoomY;
		const midpoint = getMidpoint(touch1, touch2);
		pinchCenterX = midpoint.x;
		pinchCenterY = midpoint.y;
	}

	function beginSingleTouch(touch: Touch) {
		// If zoomed, start panning instead of swiping
		if (isZoomed) {
			isPanning = true;
			isSwiping = false;
			swipeDirection = null;
			touchDeltaX = 0;
			touchDeltaY = 0;
			panStartX = touch.clientX;
			panStartY = touch.clientY;
			initialZoomX = zoomX;
			initialZoomY = zoomY;
			gestureBox = getImageBox();
			return;
		}
		
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchDeltaX = 0;
		touchDeltaY = 0;
		isSwiping = false;
		isPanning = false;
		swipeDirection = null;
		touchStartTime = Date.now();
	}

	function handleTouchStart(e: TouchEvent) {
		// Handle pinch start (two fingers)
		if (e.touches.length === 2) {
			startPinch(e.touches[0], e.touches[1]);
			return;
		}
		
		if (e.touches.length !== 1 || isPinching) return;
		
		beginSingleTouch(e.touches[0]);
	}
	
	function handleTouchMove(e: TouchEvent) {
		// Handle pinch zoom
		if (e.touches.length === 2 && isPinching) {
			e.preventDefault();
			const currentDistance = getDistance(e.touches[0], e.touches[1]);
			const newScale = Math.max(
				MIN_ZOOM,
				Math.min(MAX_ZOOM, initialPinchScale * (currentDistance / initialPinchDistance))
			);
			// Ratio actually applied, so spreading past MAX_ZOOM stops moving the image too
			const ratio = newScale / initialPinchScale;
			zoomScale = newScale;
			
			// Keep the image point under the pinch centroid pinned to the centroid.
			// A point at layout offset u renders at centre + scale * u + offset, so
			// solving for the offset that holds u fixed gives the terms below.
			const midpoint = getMidpoint(e.touches[0], e.touches[1]);
			const box = gestureBox;
			if (box) {
				zoomX = (midpoint.x - box.centerX) - ratio * (pinchCenterX - box.centerX) + ratio * initialZoomX;
				zoomY = (midpoint.y - box.centerY) - ratio * (pinchCenterY - box.centerY) + ratio * initialZoomY;
			} else {
				zoomX = (midpoint.x - pinchCenterX) + ratio * initialZoomX;
				zoomY = (midpoint.y - pinchCenterY) + ratio * initialZoomY;
			}
			clampPan();
			return;
		}
		
		// Handle panning when zoomed
		if (isPanning && isZoomed && e.touches.length === 1) {
			e.preventDefault();
			const touch = e.touches[0];
			const deltaX = touch.clientX - panStartX;
			const deltaY = touch.clientY - panStartY;
			zoomX = initialZoomX + deltaX;
			zoomY = initialZoomY + deltaY;
			clampPan();
			return;
		}
		
		if (e.touches.length !== 1 || isPinching) return;
		
		const touch = e.touches[0];
		const deltaX = touch.clientX - touchStartX;
		const deltaY = touch.clientY - touchStartY;
		
		// Determine swipe direction if not already set
		if (!isSwiping) {
			if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
				isSwiping = true;
				if (Math.abs(deltaX) > Math.abs(deltaY)) {
					swipeDirection = 'horizontal';
				} else {
					swipeDirection = 'vertical';
				}
			}
		}
		
		if (isSwiping) {
			// e.preventDefault(); // Prevent scrolling while swiping - handled by touch-action: none
			if (swipeDirection === 'horizontal') {
				touchDeltaX = deltaX;
				touchDeltaY = 0;
			} else {
				touchDeltaX = 0;
				touchDeltaY = deltaY;
			}
		}
	}
	
	function handleTouchEnd(e: TouchEvent) {
		// Handle pinch end
		if (isPinching) {
			isPinching = false;
			// Snap back to 1x if close enough
			if (zoomScale < ZOOM_SNAP_BACK) {
				resetZoom();
			} else {
				clampPan();
				initialZoomX = zoomX;
				initialZoomY = zoomY;
			}
			
			// Fingers still down: continue as a pinch or a pan/swipe instead of
			// falling through with a stale touch origin (which read as a huge swipe)
			if (e.touches.length >= 2) {
				startPinch(e.touches[0], e.touches[1]);
			} else if (e.touches.length === 1) {
				beginSingleTouch(e.touches[0]);
			}
			return;
		}
		
		// Handle pan end
		if (isPanning) {
			isPanning = false;
			
			// Check if this was a tap (no significant movement) - allow double-tap to reset zoom
			if (e.changedTouches.length === 1 && currentItem?.type === 'image') {
				const touch = e.changedTouches[0];
				const panDx = touch.clientX - panStartX;
				const panDy = touch.clientY - panStartY;
				const panDistance = Math.sqrt(panDx * panDx + panDy * panDy);
				
				if (panDistance < 10) {
					const now = Date.now();
					const timeDiff = now - lastTapTime;
					const dx = touch.clientX - lastTapX;
					const dy = touch.clientY - lastTapY;
					const distance = Math.sqrt(dx * dx + dy * dy);
					
					if (timeDiff < DOUBLE_TAP_DELAY && distance < DOUBLE_TAP_DISTANCE) {
						resetZoom();
						lastTapTime = 0;
						return;
					}
					
					lastTapTime = now;
					lastTapX = touch.clientX;
					lastTapY = touch.clientY;
				}
			}
			
			initialZoomX = zoomX;
			initialZoomY = zoomY;
			return;
		}
		
		// Detect double tap (only for images, not videos)
		if (!isSwiping && e.changedTouches.length === 1 && currentItem?.type === 'image') {
			const touch = e.changedTouches[0];
			const now = Date.now();
			const timeDiff = now - lastTapTime;
			const dx = touch.clientX - lastTapX;
			const dy = touch.clientY - lastTapY;
			const distance = Math.sqrt(dx * dx + dy * dy);
			
			if (timeDiff < DOUBLE_TAP_DELAY && distance < DOUBLE_TAP_DISTANCE) {
				// Double tap detected - toggle zoom
				if (isZoomed) {
					resetZoom();
				} else {
					// Zoom in centered on the tap location. The image box is offset from
					// the viewport centre (counter/thumbnails below), so anchor on it.
					const box = getImageBox();
					gestureBox = box;
					zoomScale = DOUBLE_TAP_ZOOM;
					const centerX = box ? box.centerX : window.innerWidth / 2;
					const centerY = box ? box.centerY : window.innerHeight / 2;
					zoomX = (centerX - touch.clientX) * (zoomScale - 1);
					zoomY = (centerY - touch.clientY) * (zoomScale - 1);
					clampPan();
				}
				lastTapTime = 0; // Reset to prevent triple-tap issues
				return;
			}
			
			lastTapTime = now;
			lastTapX = touch.clientX;
			lastTapY = touch.clientY;
		}
		
		if (!isSwiping) {
			touchDeltaX = 0;
			touchDeltaY = 0;
			return;
		}
		
		const elapsed = Date.now() - touchStartTime;
		
		if (swipeDirection === 'horizontal') {
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
		} else if (swipeDirection === 'vertical') {
			const velocity = Math.abs(touchDeltaY) / elapsed;
			const isValidSwipe = Math.abs(touchDeltaY) > SWIPE_VERTICAL_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD;
			
			if (isValidSwipe) {
				onclose?.();
			}
		}
		
		// Reset
		touchDeltaX = 0;
		touchDeltaY = 0;
		isSwiping = false;
		swipeDirection = null;
	}

	let overlayOpacity = $derived(Math.max(0, 1 - Math.abs(touchDeltaY) / 300));
	let contentScale = $derived(Math.max(0.5, 1 - Math.abs(touchDeltaY) / 600));
	
	// Combined transform for zoomed image (identity while at rest)
	let imageTransform = $derived(
		`translate(${zoomX}px, ${zoomY}px) scale(${zoomScale})`
	);
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="lightbox-overlay"
		style="background: rgba(0, 0, 0, {0.95 * overlayOpacity}); transition: {isSwiping ? 'none' : 'background 0.2s ease-out'};"
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
			style="transform: translate({touchDeltaX}px, {touchDeltaY}px) scale({contentScale}); transition: {isSwiping ? 'none' : 'transform 0.2s ease-out'};"
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
					poster={currentItem.thumbnailUrl}
					class="lightbox-video"
					controls
					autoplay
					playsinline
				></video>
			{:else if currentItem}
				<div class="image-container">
					{#if imageLoading}
						<div class="loading-spinner" aria-label="Loading image">
							<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="white" stroke-width="2">
								<circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
								<path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round">
									<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
								</path>
							</svg>
						</div>
					{/if}
					<img 
						src={currentItem.url} 
						alt="" 
						class="lightbox-image" 
						class:loaded={!imageLoading}
						class:zoomed={isZoomed || isPinching}
						style="transform: {imageTransform}"
						bind:this={imageEl}
						onload={() => handleImageLoad(currentItem.url)}
					/>
				</div>
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
		
		{#if isZoomed}
			<div class="zoom-indicator">
				<span>{Math.round(zoomScale * 100)}%</span>
				<span class="zoom-hint">Double-tap to reset</span>
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
		overscroll-behavior: none;
		touch-action: none;
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

	.image-container {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		max-width: 100%;
		max-height: 100%;
		min-width: 80px;
		min-height: 80px;
	}

	.loading-spinner {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1;
		pointer-events: none;
	}

	.lightbox-image,
	.lightbox-video {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: var(--radius-md);
		transition: transform 0.1s ease-out, opacity 0.2s ease-out;
		transform-origin: center center;
		opacity: 0;
	}

	.lightbox-image.loaded {
		opacity: 1;
	}

	.lightbox-video {
		opacity: 1;
	}
	
	.lightbox-image.zoomed {
		/* Size stays the fitted size - the zoom is entirely in the transform,
		   otherwise the image jumps to its natural pixel size mid-gesture */
		border-radius: 0;
		transition: none;
		opacity: 1;
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
	
	.zoom-indicator {
		position: absolute;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.7);
		color: white;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		pointer-events: none;
		z-index: 1002;
	}
	
	.zoom-hint {
		font-size: 0.75rem;
		opacity: 0.7;
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
			touch-action: none; /* Disable browser handling of gestures to allow custom swipe/pinch logic */
			overflow: hidden;
		}
		
		.lightbox-image.zoomed {
			cursor: grab;
		}
		
		.lightbox-counter {
			font-size: 1rem;
		}
		
		/* Swipe/zoom hint on mobile */
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
		
		.zoom-indicator {
			bottom: 5rem;
		}
	}
</style>
