<script lang="ts">
	import logo from '$lib/assets/favicon.svg';
	import Reactions from '$lib/components/Reactions.svelte';
	import ImageLightbox from '$lib/components/ImageLightbox.svelte';
	import { getMapsUrl } from '$lib/maps';
	import { SvelteMap } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { canReact } from '$lib/roles';

	// User menu state
	let userMenuOpen = $state(false);

	function toggleUserMenu() {
		userMenuOpen = !userMenuOpen;
	}

	function closeUserMenu() {
		userMenuOpen = false;
	}

	type ReactionCount = {
		emoji: string;
		count: number;
		userReacted: boolean;
	};
	
	type MilestoneMeta = {
		type: 'coordinates' | 'link' | 'icon';
		label?: string;
		value: string;
		icon?: string;
	};

	type MediaItem = {
		type: 'image' | 'video';
		url: string;
		thumbnailUrl?: string;
		isReady: boolean;
	};

	type Milestone = {
		id: number;
		title: string;
		description: string;
		date: { month: string; day: string; year: string };
		media?: MediaItem[];
		avatar?: string;
		side: 'left' | 'right';
		segment: string;
		segmentIcon: string;
		meta?: MilestoneMeta[];
		commentCount?: number;
		reactions?: ReactionCount[];
	};

	// Lightbox state
	let lightboxOpen = $state(false);
	let lightboxMedia = $state<MediaItem[]>([]);
	let lightboxIndex = $state(0);

	function openLightbox(media: MediaItem[], index: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		// Only include ready videos
		lightboxMedia = media.filter(m => m.type === 'image' || m.isReady);
		lightboxIndex = index;
		lightboxOpen = true;
	}

	function closeLightbox() {
		lightboxOpen = false;
	}

	let swipedItemId = $state<number | null>(null);
	let touchStartX = $state(0);
	let touchCurrentX = $state(0);
	let isSwiping = $state(false);
	let swipingItemId = $state<number | null>(null);
	let swipingFromSwiped = $state(false);

	function handleTouchStart(e: TouchEvent, milestoneId: number) {
		touchStartX = e.touches[0].clientX;
		touchCurrentX = e.touches[0].clientX;
		isSwiping = true;
		swipingItemId = milestoneId;
		swipingFromSwiped = swipedItemId === milestoneId;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isSwiping) return;
		touchCurrentX = e.touches[0].clientX;
	}

	function handleTouchEnd(milestoneId: number) {
		if (!isSwiping) return;
		const diff = touchStartX - touchCurrentX;
		const threshold = 50;

		if (swipingFromSwiped) {
			// Was already swiped - only swipe right (positive diff means swiping more left, negative means swiping back)
			if (diff < -threshold) {
				swipedItemId = null;
			}
		} else {
			// Not swiped - swipe left to reveal
			if (diff > threshold) {
				swipedItemId = milestoneId;
			}
		}

		isSwiping = false;
		swipingItemId = null;
		swipingFromSwiped = false;
		touchStartX = 0;
		touchCurrentX = 0;
	}

	function getSwipeOffset(milestoneId: number): number {
		if (swipingItemId !== milestoneId || !isSwiping) return 0;
		const diff = touchStartX - touchCurrentX;
		if (swipingFromSwiped) {
			// When swiping back, allow full range, limit bounce forward
			return Math.min(20, diff);
		}
		// Allow full swipe left, limit bounce back to -20
		return Math.max(-20, diff);
	}

	type GroupedMilestones = {
		segment: string;
		segmentIcon: string;
		milestones: Milestone[];
	};

	let { data } = $props();

	let additionalMilestones = $state<Milestone[]>([]);
	let hasMore = $state(true);
	let loading = $state(false);
	let sentinel: HTMLDivElement;
	
	// Track updated reactions per milestone
	let milestoneReactionsMap = new SvelteMap<number, ReactionCount[]>();

	let milestones = $derived([...data.milestones, ...additionalMilestones]);
	
	function getReactions(milestone: Milestone): ReactionCount[] {
		return milestoneReactionsMap.get(milestone.id) ?? milestone.reactions ?? [];
	}

	async function handleReaction(milestoneId: number, emoji: string) {
		const res = await fetch('/api/reactions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetType: 'milestone', targetId: String(milestoneId), emoji })
		});
		if (res.ok) {
			const { reactions } = await res.json();
			milestoneReactionsMap.set(milestoneId, formatReactions(reactions, data.user?.id));
		}
	}

	function formatReactions(grouped: Record<string, { count: number; userIds: string[] }>, userId?: string): ReactionCount[] {
		return Object.entries(grouped).map(([emoji, data]) => ({
			emoji,
			count: data.count,
			userReacted: userId ? data.userIds.includes(userId) : false
		}));
	}

	function getDateKey(date: { month: string; day: string; year: string }): string {
		return `${date.year}-${date.month}-${date.day}`;
	}

	function formatDateDivider(date: { month: string; day: string; year: string }): string {
		return `${date.month} ${date.day}, ${date.year}`;
	}

	// Group milestones by segment (descending order)
	let groupedMilestones = $derived.by(() => {
		const groups: GroupedMilestones[] = [];
		let currentGroup: GroupedMilestones | null = null;

		for (const milestone of milestones) {
			if (!currentGroup || currentGroup.segment !== milestone.segment) {
				currentGroup = {
					segment: milestone.segment,
					segmentIcon: milestone.segmentIcon,
					milestones: []
				};
				groups.push(currentGroup);
			}
			currentGroup.milestones.push(milestone);
		}

		return groups.reverse();
	});

	async function loadMore() {
		if (loading || !hasMore) return;

		loading = true;
		try {
			const response = await fetch(`/api/milestones?offset=${milestones.length}&limit=10`);
			const result = await response.json();
			additionalMilestones = [...additionalMilestones, ...result.milestones];
			hasMore = result.hasMore;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!sentinel) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					loadMore();
				}
			},
			{ rootMargin: '100px' }
		);

		observer.observe(sentinel);

		return () => observer.disconnect();
	});
</script>

<svelte:head>
	<title>Toulouse - Tsévié | Travel Ticker | Magnamondo</title>
</svelte:head>

{#if data.user}
	<div class="user-menu-container">
		<button class="user-menu-trigger" onclick={toggleUserMenu} aria-label="User menu">
			<span class="user-avatar">👤</span>
		</button>
		{#if userMenuOpen}
			<button class="user-menu-backdrop" onclick={closeUserMenu} aria-label="Close menu"></button>
			<div class="user-menu-dropdown">
				<div class="user-menu-header">
					<span class="user-email">{data.user.email}</span>
				</div>
				<div class="user-menu-items">
					<a href={resolve("/profile")} class="user-menu-item" onclick={closeUserMenu}>
						<span class="menu-icon">👤</span>
						<span>Profile</span>
					</a>
					<form method="post" action="?/logout" use:enhance class="user-menu-form">
						<button type="submit" class="user-menu-item user-menu-button">
							<span class="menu-icon">🚪</span>
							<span>Logout</span>
						</button>
					</form>
				</div>
			</div>
		{/if}
	</div>
{/if}

<section class="timeline-section">
	<header class="timeline-header">
		<img src={logo} alt="Magnamondo" class="logo" />
		<p>
			<span>Toulouse</span> <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 24" width="200" height="24">
				<polyline points="0,12 8,6 8,18 0,12" fill="#3b82f6" />
				<line x1="8" y1="12" x2="192" y2="12" stroke="#3b82f6" stroke-width="2" />
				<polyline points="200,12 192,6 192,18 200,12" fill="#3b82f6" />
			</svg> <span>Tsévié</span>
		</p>
	</header>

	{#each groupedMilestones as group (group.segment + '-' + group.milestones[0]?.id)}
		<div class="segment-section">
			<div class="segment-header">
				<div class="segment-line segment-line-left"></div>
				<span class="segment-icon">{group.segmentIcon}</span>
				<span class="segment-name">{group.segment}</span>
				<div class="segment-line segment-line-right"></div>
			</div>

			<div class="timeline">
				{#each group.milestones as milestone, idx (milestone.id)}
					{@const prevMilestone = group.milestones[idx - 1]}
					{@const isNewDate = !prevMilestone || getDateKey(milestone.date) !== getDateKey(prevMilestone.date)}
					{#if isNewDate}
						<div class="date-divider">
							<span class="date-divider-text">{formatDateDivider(milestone.date)}</span>
						</div>
					{/if}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="timeline-item {milestone.side}"
						class:has-meta={milestone.meta?.length}
						class:swiped={swipedItemId === milestone.id && !isSwiping}
						class:swiping={swipingItemId === milestone.id && !swipingFromSwiped}
						class:swiping-back={swipingItemId === milestone.id && swipingFromSwiped}
						ontouchstart={(e) => milestone.meta?.length && handleTouchStart(e, milestone.id)}
						ontouchmove={handleTouchMove}
						ontouchend={() => handleTouchEnd(milestone.id)}
						style={swipingItemId === milestone.id ? `--swipe-offset: ${getSwipeOffset(milestone.id)}px` : ''}
					>
						{#if milestone.meta?.length}
							<div class="timeline-meta" class:meta-left={milestone.side === 'right'} class:meta-right={milestone.side === 'left'}>
								{#each milestone.meta as meta (meta.type + meta.value)}
									{#if meta.type === 'coordinates'}
										<a href={getMapsUrl(meta.value)} target="_blank" rel="noopener" class="meta-item meta-coordinates">
											<span class="meta-icon">📍</span>
											<span class="meta-label">{meta.label || 'Location'}</span>
										</a>
									{:else if meta.type === 'link'}
										<a href={meta.value} target="_blank" rel="noopener" class="meta-item meta-link">
											<span class="meta-icon">{meta.icon || '🔗'}</span>
											<span class="meta-label">{meta.label || 'Link'}</span>
										</a>
									{:else if meta.type === 'icon'}
										<div class="meta-item meta-icon-only">
											<span class="meta-icon">{meta.icon || meta.value}</span>
											{#if meta.label}
												<span class="meta-label">{meta.label}</span>
											{/if}
										</div>
									{/if}
								{/each}
							</div>
							<!-- Mobile swipe indicator -->
							<div class="swipe-indicator">
								<span class="swipe-chevron">‹</span>
							</div>
						{/if}
						<a href="/entry/{milestone.id}" class="timeline-content">
							<div class="card">
								{#if milestone.avatar}
									<img src={milestone.avatar} alt="" class="avatar" />
								{/if}
								<div class="card-body">
									<h3>{milestone.title}</h3>
									<p>{milestone.description}</p>
									{#if milestone.media}
										<div class="media-grid">
											{#each milestone.media as item, i (i)}
												{@const mediaIndex = milestone.media!.slice(0, i).filter(m => m.type === 'image' || m.isReady).length}
												{#if item.type === 'image'}
													<button
														class="thumbnail-button"
														onclick={(e) => openLightbox(milestone.media!, mediaIndex, e)}
														aria-label="View image {i + 1}"
													>
														<img src={item.thumbnailUrl || item.url} alt="" class="thumbnail" />
													</button>
												{:else}
													<!-- Video: show thumbnail, play icon when ready -->
													<button
														class="thumbnail-button video-thumb"
														onclick={(e) => item.isReady && openLightbox(milestone.media!, mediaIndex, e)}
														aria-label={item.isReady ? 'Play video' : 'Video processing'}
														disabled={!item.isReady}
													>
														{#if item.thumbnailUrl}
															<img src={item.thumbnailUrl} alt="" class="thumbnail" />
														{:else}
															<div class="thumbnail video-placeholder">
																<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
																	<path d="M8 5v14l11-7z"/>
																</svg>
															</div>
														{/if}
														{#if item.isReady}
															<div class="play-overlay">
																<svg viewBox="0 0 24 24" fill="currentColor">
																	<path d="M8 5v14l11-7z"/>
																</svg>
															</div>
														{/if}
													</button>
												{/if}
											{/each}
										</div>
									{/if}
								</div>
							</div>
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
							<div class="card-reactions" class:hidden={swipedItemId === milestone.id} onclick={(e) => e.preventDefault()}>
								<Reactions
									reactions={getReactions(milestone)}
									targetType="milestone"
									targetId={String(milestone.id)}
									isLoggedIn={!!data.user}
									canReact={canReact(data.user?.roles)}
									onReact={(emoji) => handleReaction(milestone.id, emoji)}
								/>
							</div>
						</a>
						{#if milestone.commentCount}
							<div class="timeline-dot comment-bubble" title="{milestone.commentCount} comments">
								<svg class="comment-shape" viewBox="0 0 24 24" fill="currentColor">
									<path d="M2 6a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H7l-5 5V6z"/>
								</svg>
								<span class="comment-count">{milestone.commentCount}</span>
							</div>
						{:else}
							<div class="timeline-dot"></div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/each}

	<div bind:this={sentinel} class="sentinel">
		{#if loading}
			<div class="loading">Loading more...</div>
		{:else if !hasMore}
			<div class="end-message">You've reached the start!</div>
		{/if}
	</div>
</section>

<ImageLightbox
	media={lightboxMedia}
	currentIndex={lightboxIndex}
	open={lightboxOpen}
	onclose={closeLightbox}
/>

<style>
	/* User Menu */
	.user-menu-container {
		position: fixed;
		top: 1rem;
		right: 1rem;
		z-index: 1000;
	}

	.user-menu-trigger {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 2px solid var(--color-border);
		background: var(--color-bg-elevated);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.2s, box-shadow 0.2s;
		box-shadow: var(--shadow-sm);
	}

	.user-menu-trigger:hover {
		border-color: var(--color-primary);
	}

	.user-avatar {
		font-size: 1.25rem;
	}

	.user-menu-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: -1;
		background: transparent;
		border: none;
		cursor: default;
	}

	.user-menu-dropdown {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		min-width: 220px;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}

	.user-menu-header {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.user-email {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		word-break: break-all;
	}

	.user-menu-items {
		padding: 0.5rem 0;
	}

	.user-menu-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		width: 100%;
		text-decoration: none;
		color: var(--color-text);
		font-size: 0.9rem;
		transition: background 0.15s;
	}

	.user-menu-item:hover {
		background: var(--color-bg-secondary);
	}

	.user-menu-button {
		border: none;
		background: none;
		cursor: pointer;
		text-align: left;
	}

	.user-menu-form {
		margin: 0;
	}

	.menu-icon {
		font-size: 1rem;
	}

	.timeline-section {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	.timeline-header {
		text-align: center;
		margin-bottom: 3rem;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.timeline-header .logo {
		height: 80px;
		width: 80px;
		margin-bottom: 1rem;
	}

	.timeline-header p {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin: 0;
	}

	.timeline-header p span {
		min-width: 6rem;
	}

	.timeline-header p span:first-child {
		text-align: right;
	}

	.timeline-header p span:last-child {
		text-align: left;
	}

	.timeline-header p svg {
		vertical-align: middle;
	}

	.timeline-header p svg polyline {
		fill: var(--color-primary);
	}

	.timeline-header p svg line {
		stroke: var(--color-primary);
	}

	.timeline {
		position: relative;
		padding: 1rem 0;
	}

	.timeline::before {
		content: '';
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		top: 0;
		bottom: 0;
		width: 2px;
		background: linear-gradient(
			to bottom,
			transparent 0%,
			color-mix(in srgb, var(--color-border) 75%, transparent) 2rem,
			color-mix(in srgb, var(--color-border) 75%, transparent) calc(100% - 2rem),
			transparent 100%
		);
	}

	.timeline-item {
		position: relative;
		display: flex;
		align-items: center;
		margin-bottom: 2rem;
	}

	.timeline-item.left {
		justify-content: flex-start;
		padding-right: 50%;
	}

	.timeline-item.right {
		justify-content: flex-end;
		padding-left: 50%;
	}

	.timeline-content {
		position: relative;
		width: 100%;
		padding: 0 2rem;
		transition: transform 0.3s ease;
		text-decoration: none;
		color: inherit;
		display: block;
	}

	.timeline-content:hover .card {
		box-shadow: var(--shadow-md);
	}

	.card-reactions {
		margin-top: 0.5rem;
		opacity: 1;
		transition: opacity 0.2s ease;
	}

	.card-reactions.hidden {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.1s ease;
	}

	.timeline-meta {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.5rem;
		z-index: 0;
	}

	.timeline-meta.meta-left {
		right: calc(50% + 2rem);
		align-items: flex-end;
	}

	.timeline-meta.meta-right {
		left: calc(50% + 2rem);
		align-items: flex-start;
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.15rem 0.25rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		transition: color 0.2s;
	}

	.meta-item:hover {
		color: var(--color-text);
	}

	a.meta-item {
		cursor: pointer;
	}

	.meta-icon {
		font-size: 0.875rem;
		line-height: 1;
		opacity: 0.8;
	}

	.meta-label {
		color: inherit;
		font-size: 0.7rem;
		white-space: nowrap;
	}

	.swipe-indicator {
		display: none;
	}

	.timeline-dot {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		margin-top: -1rem; /* Offset for reactions below the card */
		width: 12px;
		height: 12px;
		background: var(--color-primary);
		border-radius: 50%;
		z-index: 1;
	}

	.timeline-dot.comment-bubble {
		width: auto;
		height: auto;
		background: transparent;
		border-radius: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		padding: 1rem;
		box-shadow: var(--shadow-sm);
	}

	.timeline-item.right .card {
		flex-direction: row-reverse;
	}

	.card-body {
		flex: 1;
	}

	.card-body h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.comment-shape {
		width: 24px;
		height: 28px;
		color: var(--color-accent);
		filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2));
	}

	.timeline-item.right .comment-shape {
		transform: scaleX(-1);
	}

	.comment-count {
		position: absolute;
		top: 44%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--color-text-on-accent);
		line-height: 1;
		text-align: center;
	}

	.card-body p {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.media-grid {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}

	.thumbnail-button {
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		border-radius: var(--radius-sm);
		overflow: hidden;
		transition: transform 0.2s, box-shadow 0.2s;
		position: relative;
	}

	.thumbnail-button:hover {
		transform: scale(1.1);
		box-shadow: var(--shadow-md);
	}

	.thumbnail-button:disabled {
		cursor: default;
		opacity: 0.8;
	}

	.thumbnail-button:disabled:hover {
		transform: none;
		box-shadow: none;
	}

	.video-thumb .play-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.3);
		opacity: 0;
		transition: opacity 0.2s;
	}

	.video-thumb:not(:disabled):hover .play-overlay {
		opacity: 1;
	}

	.video-thumb .play-overlay svg {
		width: 20px;
		height: 20px;
		color: white;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
	}

	.thumbnail {
		width: 60px;
		height: 60px;
		border-radius: var(--radius-sm);
		object-fit: cover;
		background: var(--color-border);
		display: block;
	}

	.video-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
	}

	.date-divider {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0;
		margin-bottom: 1rem;
		position: relative;
		z-index: 2;
	}

	.date-divider-text {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		white-space: nowrap;
		background: var(--color-bg);
		padding: 0.4rem 1.25rem;
		border-radius: var(--radius-md);
		border: 1.5px solid color-mix(in srgb, var(--color-border) 75%, transparent);
		box-shadow: 
			inset 0 1px 2px rgba(0, 0, 0, 0.1),
			0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.avatar {
		width: 50px;
		height: 50px;
		border-radius: var(--radius-full);
		object-fit: cover;
		background: var(--color-border);
	}

	@media (max-width: 768px) {
		.timeline-section {
			padding: 1.5rem 0.75rem;
		}

		.timeline-header {
			margin-bottom: 2rem;
		}

		.timeline-header .logo {
			height: 64px;
			width: 64px;
		}

		.timeline::before {
			left: 16px;
		}

		.timeline {
			padding: 0.5rem 0;
		}

		.timeline-item {
			margin-bottom: 1rem;
		}

		.timeline-item.left,
		.timeline-item.right {
			padding-left: 40px;
			padding-right: 0;
			justify-content: flex-start;
		}

		.timeline-dot {
			left: 16px;
			width: 10px;
			height: 10px;
			margin-top: -0.75rem;
		}

		.timeline-dot.comment-bubble {
			width: auto;
			height: auto;
		}

		.timeline-item.right .card {
			flex-direction: row;
		}

		.comment-shape {
			width: 22px;
			height: 22px;
			transform: scaleX(-1);
		}

		.comment-count {
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			font-size: 0.55rem;
		}

		.timeline-content {
			padding: 0;
		}

		.card {
			padding: 0.875rem;
			gap: 0.75rem;
			transition: box-shadow 0.2s ease;
		}

		.card-body h3 {
			font-size: 0.9rem;
		}

		.card-body p {
			font-size: 0.8rem;
		}

		.date-divider {
			justify-content: flex-start;
			padding-left: 0;
			margin-bottom: 0.5rem;
		}

		.date-divider-text {
			margin-left: 4px;
			padding: 0.35rem 0.75rem;
			font-size: 0.65rem;
		}

		.segment-section {
			margin-bottom: 0.5rem;
		}

		.segment-header {
			padding: 1rem 0;
			padding-left: 40px;
			margin-bottom: 0;
		}

		.segment-icon {
			font-size: 1.5rem;
		}

		.segment-name {
			font-size: 1rem;
		}

		/* Mobile meta panel */
		.timeline-item {
			/* overflow: hidden; */
			border-radius: var(--radius-md);
		}

		.timeline-item.has-meta {
			touch-action: pan-y pinch-zoom;
		}

		.timeline-meta {
			position: absolute;
			top: 50%;
			bottom: auto;
			right: 0.5rem;
			left: auto;
			transform: translateY(-50%) translateX(20px);
			transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.3s ease;
			justify-content: center;
			align-items: center;
			padding: 0.5rem;
			gap: 0.5rem;
			min-width: auto;
			z-index: 0;
			opacity: 0;
		}

		.timeline-meta.meta-left,
		.timeline-meta.meta-right {
			right: 0.5rem;
			left: auto;
			align-items: center;
		}

		.timeline-item.swiping .timeline-content {
			transform: translateX(calc(-1 * var(--swipe-offset, 0px)));
			transition: none;
		}

		.timeline-item.swiping .timeline-meta {
			transform: translateY(-50%) translateX(max(0px, calc(20px - var(--swipe-offset, 0px) * 0.2)));
			opacity: min(1, var(--swipe-offset, 0) / 120);
			transition: none;
		}

		.timeline-item.swiping-back .timeline-content {
			transform: translateX(calc(-60% - var(--swipe-offset, 0px)));
			transition: none;
		}

		.timeline-item.swiping-back .timeline-meta {
			transform: translateY(-50%) translateX(0);
			opacity: max(0, 1 + var(--swipe-offset, 0) / 120);
			transition: none;
		}

		.timeline-item.swiping .timeline-content .card {
			transition: none;
			box-shadow: 
				0 calc(8px * min(1, var(--swipe-offset, 0) / 120)) calc(25px * min(1, var(--swipe-offset, 0) / 120)) rgba(0, 0, 0, calc(0.15 * min(1, var(--swipe-offset, 0) / 120))),
				0 calc(4px * min(1, var(--swipe-offset, 0) / 120)) calc(10px * min(1, var(--swipe-offset, 0) / 120)) rgba(0, 0, 0, calc(0.1 * min(1, var(--swipe-offset, 0) / 120)));
		}

		.timeline-item.swiping-back .timeline-content .card {
			transition: none;
			box-shadow: 
				0 calc(8px * max(0, 1 + var(--swipe-offset, 0) / 120)) calc(25px * max(0, 1 + var(--swipe-offset, 0) / 120)) rgba(0, 0, 0, calc(0.15 * max(0, 1 + var(--swipe-offset, 0) / 120))),
				0 calc(4px * max(0, 1 + var(--swipe-offset, 0) / 120)) calc(10px * max(0, 1 + var(--swipe-offset, 0) / 120)) rgba(0, 0, 0, calc(0.1 * max(0, 1 + var(--swipe-offset, 0) / 120)));
		}

		.timeline-item.swiped .timeline-content {
			transform: translateX(-60%);
		}

		.timeline-item.swiped .timeline-content .card {
			box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15), 0 4px 10px rgba(0, 0, 0, 0.1);
		}

		.timeline-item.swiped .timeline-meta {
			transform: translateY(-50%) translateX(0);
			opacity: 1;
		}

		.timeline-item.swiped .timeline-content,
		.timeline-item.swiping .timeline-content,
		.timeline-item.swiping-back .timeline-content {
			z-index: 2;
		}

		.timeline-item.swiped .timeline-dot,
		.timeline-item.swiping .timeline-dot,
		.timeline-item.swiping-back .timeline-dot {
			z-index: 0;
		}

		.swipe-indicator {
			display: flex;
			align-items: center;
			justify-content: center;
			position: absolute;
			right: 0;
			top: 50%;
			transform: translateY(-50%);
			width: 16px;
			height: 100%;
			color: var(--color-text-muted);
			opacity: 0.4;
			z-index: 1;
			transition: opacity 0.2s;
			background: linear-gradient(to right, transparent, rgba(59, 130, 246, 0.1));
		}

		.timeline-item.swiped .swipe-indicator {
			opacity: 0;
			pointer-events: none;
		}

		.swipe-chevron {
			font-size: 1rem;
			font-weight: 300;
			line-height: 1;
			animation: hint-pulse 2s ease-in-out infinite;
		}

		@keyframes hint-pulse {
			0%, 100% { transform: translateX(0); opacity: 0.4; }
			50% { transform: translateX(-3px); opacity: 0.7; }
		}

		.meta-item {
			color: var(--color-text);
		}

		.meta-label {
			color: var(--color-text-muted);
			font-size: 0.7rem;
		}

		.meta-icon {
			font-size: 0.9rem;
		}
	}

	.segment-section {
		margin-bottom: 1rem;
	}

	.segment-header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 1.5rem 0;
		margin-bottom: 0.5rem;
	}

	.segment-icon {
		font-size: 2rem;
		line-height: 1;
	}

	.segment-name {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.segment-line {
		flex: 1;
		height: 2px;
	}

	.segment-line-left {
		background: linear-gradient(to right, transparent, var(--color-border-strong));
	}

	.segment-line-right {
		background: linear-gradient(to right, var(--color-border-strong), transparent);
	}

	.sentinel {
		padding: 2rem;
		text-align: center;
	}

	.loading {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.end-message {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
</style>
