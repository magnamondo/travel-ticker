<script lang="ts">
	import logo from '$lib/assets/favicon.svg';
	import Reactions from '$lib/components/Reactions.svelte';
	import ImageLightbox from '$lib/components/ImageLightbox.svelte';
	import { getMapsUrl } from '$lib/maps';
	import { SvelteMap } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { canReact, isAdmin } from '$lib/roles';
	import { toasts } from '$lib/stores/toast.svelte';

	// User menu state
	let userMenuOpen = $state(false);

	function toggleUserMenu(e: Event) {
		// On touch devices, use touchend to trigger and prevent default to avoid double-handling
		if (e.type === 'touchend') {
			e.preventDefault();
		}
		userMenuOpen = !userMenuOpen;
	}

	function closeUserMenu(e?: Event) {
		if (e?.type === 'touchend') {
			e.preventDefault();
		} else if (e) {
			e.preventDefault();
		}
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

	// Track expanded media grids
	let expandedMediaIds = new SvelteMap<number, boolean>();

	function toggleMediaExpanded(milestoneId: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		expandedMediaIds.set(milestoneId, !expandedMediaIds.get(milestoneId));
	}

	function isMediaExpanded(milestoneId: number): boolean {
		return expandedMediaIds.get(milestoneId) ?? false;
	}

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
			const formatted = formatReactions(reactions, data.user?.id);
			milestoneReactionsMap.set(milestoneId, formatted);
			const userReacted = formatted.find(r => r.emoji === emoji)?.userReacted ?? false;
			toasts.success(`${emoji} ${userReacted ? 'added' : 'removed'}`);
		} else {
			toasts.error('Failed to update reaction');
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

	// Group milestones by segment (API returns in correct order: newest first)
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

		return groups;
	});

	async function loadMore() {
		if (loading || !hasMore) return;

		loading = true;
		try {
			const response = await fetch(`/api/milestones?offset=${milestones.length}&limit=3`);
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
	<title>Toulouse - Lomé | Travel Ticker | Magnamondo</title>
	<meta property="og:type" content="website">
	<meta property="og:title" content="Toulouse - Lomé | Travel Ticker">
	<meta property="og:description" content="Follow along on our adventure from Toulouse to Lomé">
	<meta property="og:image" content="{data.origin}/logo.png">
	<meta property="og:image:width" content="1200">
	<meta property="og:image:height" content="630">
	<meta property="og:url" content={data.origin}>
	<meta name="twitter:card" content="summary_large_image">
	<meta name="twitter:title" content="Toulouse - Lomé | Travel Ticker">
	<meta name="twitter:description" content="Follow along on our adventure from Toulouse to Lomé">
	<meta name="twitter:image" content="{data.origin}/logo.png">
</svelte:head>

{#if data.user}
	<div class="user-menu-container">
		<button 
			type="button" 
			class="user-menu-trigger" 
			onclick={toggleUserMenu} 
			ontouchend={toggleUserMenu}
			aria-label="User menu"
		>
			<span class="user-avatar">👤</span>
		</button>
		{#if userMenuOpen}
			<button 
				type="button" 
				class="user-menu-backdrop" 
				onclick={closeUserMenu} 
				ontouchend={closeUserMenu}
				aria-label="Close menu"
			></button>
			<div class="user-menu-dropdown">
				<div class="user-menu-header">
					<span class="user-email">{data.user.email}</span>
				</div>
				<div class="user-menu-items">
					{#if isAdmin(data.user.roles)}
						<a href={resolve("/admin")} class="user-menu-item" onclick={() => userMenuOpen = false}>
							<span class="menu-icon">⚙️</span>
							<span>Admin</span>
						</a>
					{/if}
					<a href={resolve("/profile")} class="user-menu-item" onclick={() => userMenuOpen = false}>
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
{:else}
	<div class="user-menu-container">
		<a href={resolve("/login")} class="user-menu-trigger ghost-trigger" aria-label="Log in">
			<svg class="ghost-avatar" viewBox="7 -2 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path d="M50 8C28 8 18 28 18 45C18 55 16 62 14 68C12 74 18 78 22 75C26 72 30 74 32 78C34 82 38 85 42 82C46 79 50 82 52 85C54 88 58 88 60 85C62 82 66 79 70 82C74 85 78 82 80 78C82 74 86 72 90 75C94 78 100 74 98 68C96 62 94 55 94 45C94 28 84 8 62 8C58 8 54 8 50 8Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
				<ellipse cx="38" cy="42" rx="5" ry="6" fill="currentColor"/>
				<ellipse cx="58" cy="42" rx="5" ry="6" fill="currentColor"/>
				<path d="M35 60C38 58 42 62 45 58" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
				<path d="M55 58C58 62 62 58 65 60" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
			</svg>
		</a>
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
			</svg> <span>Lomé</span>
		</p>
	</header>

	{#each groupedMilestones as group (group.segment + '-' + group.milestones[0]?.id)}
		<div class="segment-section">
			<div class="segment-header">
				<span class="segment-icon">{group.segmentIcon}</span>
				<span class="segment-name">{group.segment}</span>
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
						<div class="timeline-content">
							<a href="/entry/{milestone.id}" style="text-decoration: none; color: inherit; display: block;">
								<div class="card">
									<svg class="card-pointer" viewBox="0 0 16 28" preserveAspectRatio="none">
										<path d="M16 0 Q 6 5 0 14 Q 6 23 16 28 Z" fill="var(--color-bg-elevated)"/>
									</svg>
									{#if milestone.avatar}
										<img src={milestone.avatar} alt="" class="avatar" />
									{/if}
									<div class="card-body">
										<h3>{milestone.title}</h3>
									<p>{@html (milestone.description ?? '')
											.replace(/&/g, '&amp;')
											.replace(/</g, '&lt;')
											.replace(/>/g, '&gt;')
											.replace(/\n/g, '<br>')}</p>
									{#if milestone.media}
										{@const readyMedia = milestone.media.filter(m => m.type === 'image' || m.thumbnailUrl)}
										{@const expanded = isMediaExpanded(milestone.id)}
										{@const maxVisible = 3}
										{@const displayMedia = expanded ? readyMedia : readyMedia.slice(0, maxVisible)}
										{@const hiddenCount = readyMedia.length - maxVisible}
										{#if readyMedia.length > 0}
										<div class="media-grid" class:expanded>
											{#each displayMedia as item, i (i)}
												{@const mediaIndex = readyMedia.slice(0, expanded ? i : i).filter(m => m.type === 'image' || m.isReady).length}
												{@const isLastVisible = !expanded && i === maxVisible - 1 && hiddenCount > 0}
												{#if item.type === 'image'}
													<button
														class="thumbnail-button"
														class:has-more-overlay={isLastVisible}
														onclick={(e) => isLastVisible ? toggleMediaExpanded(milestone.id, e) : openLightbox(readyMedia, mediaIndex, e)}
														ontouchstart={(e) => e.stopPropagation()}
														aria-label={isLastVisible ? `Show ${hiddenCount} more` : `View image ${i + 1}`}
													>
														<img src={item.thumbnailUrl || item.url} alt="" class="thumbnail" />
														{#if isLastVisible}
															<div class="more-overlay">
																<span>+{hiddenCount}</span>
															</div>
														{/if}
													</button>
												{:else}
													<!-- Video with thumbnail ready -->
													<button
														class="thumbnail-button video-thumb"
														class:has-more-overlay={isLastVisible}
														onclick={(e) => isLastVisible ? toggleMediaExpanded(milestone.id, e) : (item.isReady && openLightbox(readyMedia, mediaIndex, e))}
														ontouchstart={(e) => e.stopPropagation()}
														aria-label={isLastVisible ? `Show ${hiddenCount} more` : (item.isReady ? 'Play video' : 'Video processing')}
														disabled={!isLastVisible && !item.isReady}
													>
														<img src={item.thumbnailUrl} alt="" class="thumbnail" />
														{#if isLastVisible}
															<div class="more-overlay">
																<span>+{hiddenCount}</span>
															</div>
														{:else if item.isReady}
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
									{/if}
								</div>
							</div>
							</a>
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
							<div class="card-reactions" class:hidden={swipedItemId === milestone.id}>
								<Reactions
									reactions={getReactions(milestone)}
									targetType="milestone"
									targetId={String(milestone.id)}
									isLoggedIn={!!data.user}
									canReact={canReact(data.user?.roles)}
									onReact={(emoji) => handleReaction(milestone.id, emoji)}
								/>
							</div>
						</div>
						{#if milestone.commentCount}
							<div class="timeline-dot comment-bubble" title="{milestone.commentCount} comments">
								<svg class="comment-shape" viewBox="0 0 24 24" fill="currentColor">
									<rect x="2" y="2" width="20" height="20" rx="4" ry="4"/>
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
		top: max(1rem, env(safe-area-inset-top) + 0.5rem);
		right: 1rem;
		right: max(1rem, env(safe-area-inset-right) + 1rem);
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
		-webkit-tap-highlight-color: transparent;
		-webkit-appearance: none;
		appearance: none;
	}

	@media (hover: hover) {
		.user-menu-trigger:hover {
			border-color: var(--color-primary);
		}
	}

	.user-avatar {
		font-size: 1.25rem;
	}

	.ghost-trigger {
		text-decoration: none;
	}

	.ghost-avatar {
		width: 28px;
		height: 28px;
		color: var(--color-text-muted);
		transition: color 0.2s, transform 0.2s;
	}

	@media (hover: hover) {
		.ghost-trigger:hover .ghost-avatar {
			color: var(--color-primary);
			transform: scale(1.1);
		}
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
		-webkit-tap-highlight-color: transparent;
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
		transform: translateZ(0); /* Fix Safari rendering issues */
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
		left: 24px;
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
		padding-left: 32px;
		justify-content: flex-start;
	}

	/* Override left/right - all items on right side now */
	.timeline-item.left,
	.timeline-item.right {
		justify-content: flex-start;
		padding-left: 32px;
		padding-right: 0;
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
		filter: drop-shadow(var(--shadow-md));
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
		/* Position meta at the right edge of the card, hidden by default */
		right: 0;
		transform: translateY(-50%) translateX(100%);
		opacity: 0;
		pointer-events: none;
	}

	/* Both meta-left and meta-right use same positioning now */
	.timeline-meta.meta-left,
	.timeline-meta.meta-right {
		right: 0;
		left: auto;
		align-items: flex-start;
		padding-left: 1rem;
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
		left: 24px;
		/* Align with card-pointer: centered, but max ~214px from top for tall cards */
		/* Add 1rem to compensate for the margin-top offset on capped value */
		top: min(50%, calc(200px + 14px + 1rem));
		transform: translate(-50%, -50%);
		margin-top: -1rem; /* Offset for reactions below the card */
		width: 12px;
		height: 12px;
		background: var(--color-primary);
		border-radius: 50%;
		z-index: 1;
		box-shadow: var(--shadow-sm);
		transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
	}

	.timeline-content:hover ~ .timeline-dot {
		box-shadow: var(--shadow-md);
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
		filter: drop-shadow(var(--shadow-sm));
		transition: filter 0.2s ease;
		position: relative;
	}

	/* Curved pointer towards timeline dot - all point left now */
	.card-pointer {
		position: absolute;
		/* Center vertically, but max 200px from top for tall cards */
		top: min(calc(50% - 14px), 200px);
		width: 16px;
		height: 28px;
		left: -16px;
	}

	/* No transform needed - pointer points left by default */
	.timeline-item.left .card-pointer,
	.timeline-item.right .card-pointer {
		left: -16px;
		right: auto;
		transform: none;
	}

	/* All cards use same layout - no row-reverse */
	.timeline-item.right .card {
		flex-direction: row;
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
		width: 22px;
		height: 22px;
		color: var(--color-accent);
		filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2));
	}

	.comment-count {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--color-text-on-accent);
		line-height: 1;
		text-align: center;
	}

	.card-body p {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.media-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.25rem;
		margin-top: 0.75rem;
	}

	/* 1 image: full width, landscape */
	.media-grid:has(.thumbnail-button:only-child) {
		grid-template-columns: 1fr;
	}

	/* 2 images: 2 columns */
	.media-grid:has(.thumbnail-button:nth-child(2)):not(:has(.thumbnail-button:nth-child(3))) {
		grid-template-columns: repeat(2, 1fr);
	}

	.thumbnail-button {
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		border-radius: var(--radius-sm);
		overflow: hidden;
		transition: filter 0.15s;
		position: relative;
		aspect-ratio: 1;
	}

	/* Single image: landscape aspect ratio */
	.thumbnail-button:only-child {
		aspect-ratio: 16 / 10;
	}

	/* 3+ images: first image spans 2 columns and 2 rows */
	.media-grid:has(.thumbnail-button:nth-child(3)) .thumbnail-button:first-child {
		grid-column: span 2;
		grid-row: span 2;
	}

	.thumbnail-button:hover {
		filter: brightness(0.9);
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
		width: 28px;
		height: 28px;
		color: white;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
	}

	.more-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		border-radius: var(--radius-sm);
	}

	.more-overlay span {
		color: white;
		font-size: 1.25rem;
		font-weight: 600;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
	}

	.thumbnail-button.has-more-overlay:hover .more-overlay {
		background: rgba(0, 0, 0, 0.7);
	}

	.thumbnail {
		width: 100%;
		height: 100%;
		border-radius: var(--radius-md);
		object-fit: cover;
		background: var(--color-border);
		display: block;
	}

	.video-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		width: 100%;
		height: 100%;
	}

	.date-divider {
		display: flex;
		justify-content: flex-start;
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
			inset 0 1px 4px rgba(0, 0, 0, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.05);
		/* Center on timeline line at 24px */
		position: relative;
		left: 24px;
		transform: translateX(-50%);
	}

	.avatar {
		width: 50px;
		height: 50px;
		border-radius: var(--radius-full);
		object-fit: cover;
		background: var(--color-border);
	}

	/* Tablet: 769px - 1023px */
	@media (min-width: 769px) and (max-width: 1023px) {
		.date-divider-text {
			/* Prevent off-screen clipping on narrow tablets */
			left: 0;
			transform: none;
			margin-left: 6px;
		}
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
			margin-bottom: 2rem;
		}

		.timeline-item.left,
		.timeline-item.right {
			padding-left: 42px;
			padding-right: 1rem;
			justify-content: flex-start;
		}

		.timeline-dot {
			left: 16px;
			width: 10px;
			height: 10px;
		}

		.timeline-dot.comment-bubble {
			width: auto;
			height: auto;
			margin-top: -17px;
		}

		.timeline-item.right .card {
			flex-direction: row;
		}

		.comment-shape {
			width: 20px;
			height: 20px;
		}

		.comment-count {
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

		/* On mobile, all cards are on the right, pointer points left */
		.timeline-item.left .card-pointer,
		.timeline-item.right .card-pointer {
			right: auto;
			left: -16px;
			transform: none;
			top: min(calc(50% - 14px), 200px);
		}

		.card-body h3 {
			font-size: 0.9rem;
		}

		.card-body p {
			font-size: 0.8rem;
		}

		/* Mobile: 3-column grid same as desktop */
		.media-grid {
			grid-template-columns: repeat(3, 1fr);
			gap: 0.2rem;
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
			/* Limit centering on mobile */
			left: 16px;
			transform: translateX(-20px);
		}

		.segment-section {
			margin-bottom: 0.5rem;
		}

		.segment-header {
			padding: 1rem 0;
			padding-left: 48px;
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
			top: 0;
			bottom: 2rem;
			width: 16px;
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
		justify-content: flex-start;
		gap: 0.75rem;
		padding: 1.5rem 0;
		padding-left: 8px;
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
