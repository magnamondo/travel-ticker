<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { categories } from '$lib/emojis';

	let { onselect } = $props<{ onselect: (emoji: string) => void }>();

	let activeCategory = $state('recent');
	let recentEmojis = $state<string[]>([]);
	let container: HTMLDivElement | undefined = $state();
	let isScrolling = false;

	function loadRecents() {
		try {
			const stored = localStorage.getItem('recent-emojis');
			if (stored) {
				recentEmojis = JSON.parse(stored);
			}
		} catch (e) {
			console.error('Failed to load recent emojis', e);
		}
	}

	function updateRecents(emoji: string) {
		const newRecents = [emoji, ...recentEmojis.filter(e => e !== emoji)].slice(0, 16);
		recentEmojis = newRecents;
		localStorage.setItem('recent-emojis', JSON.stringify(newRecents));
	}

	function handleSelect(emoji: string) {
		updateRecents(emoji);
		onselect(emoji);
	}

	function scrollToCategory(id: string) {
		if (!container) return;
		const el = container.querySelector(`#category-${id}`) as HTMLElement;
		if (el) {
			isScrolling = true;
			// Use container.scrollTo instead of element.scrollIntoView to prevent page scrolling
			const offset = el.offsetTop - container.offsetTop;
			container.scrollTo({ top: offset, behavior: 'smooth' });
			
			activeCategory = id;
			// Reset scrolling flag after animation
			setTimeout(() => { isScrolling = false; }, 500);
		}
	}

	function handleScroll() {
		if (isScrolling || !container) return;
		
		const scrollTop = container.scrollTop;
		const threshold = 50; // Offset to consider section active

		// Check sections positions
		const sections = ['recent', ...categories.map(c => c.id)];
		
		for (const id of sections) {
			if (id === 'recent' && recentEmojis.length === 0) continue;
			
			const el = container.querySelector(`#category-${id}`) as HTMLElement;
			if (el) {
				const offset = el.offsetTop - container.offsetTop;
				if (scrollTop >= offset - threshold) {
					activeCategory = id;
				}
			}
		}
	}

	onMount(() => {
		loadRecents();
	});
</script>

<div class="emoji-picker-content">
	<div class="emoji-scroll-area" bind:this={container} onscroll={handleScroll}>
		{#if recentEmojis.length > 0}
			<div id="category-recent" class="category-section">
				<div class="category-header">Frequently Used</div>
				<div class="emoji-grid">
					{#each recentEmojis as emoji}
						<button 
							class="emoji-btn" 
							onclick={(e) => { e.stopPropagation(); handleSelect(emoji); }}
						>
							{emoji}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#each categories as category}
			<div id="category-{category.id}" class="category-section">
				<div class="category-header">{category.name}</div>
				<div class="emoji-grid">
					{#each category.emojis as emoji}
						<button 
							class="emoji-btn" 
							onclick={(e) => { e.stopPropagation(); handleSelect(emoji); }}
						>
							{emoji}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
	
	<div class="emoji-footer">
		{#if recentEmojis.length > 0}
			<button 
				class="footer-btn" 
				class:active={activeCategory === 'recent'}
				onclick={(e) => { e.stopPropagation(); scrollToCategory('recent'); }}
				title="Frequently Used"
			>
				🕒
			</button>
		{/if}
		{#each categories as category}
			<button 
				class="footer-btn" 
				class:active={activeCategory === category.id}
				onclick={(e) => { e.stopPropagation(); scrollToCategory(category.id); }}
				title={category.name}
			>
				{category.icon}
			</button>
		{/each}
	</div>
</div>

<style>
	.emoji-picker-content {
		display: flex;
		flex-direction: column;
		width: 320px;
		height: 350px;
		background: #f8fafc;
		overflow: hidden;
	}

	@media (prefers-color-scheme: dark) {
		.emoji-picker-content {
			background: var(--color-bg-secondary);
		}
	}

	.emoji-scroll-area {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
		scroll-behavior: smooth;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}

	.emoji-scroll-area::-webkit-scrollbar {
		width: 6px;
	}

	.emoji-scroll-area::-webkit-scrollbar-track {
		background: transparent;
	}

	.emoji-scroll-area::-webkit-scrollbar-thumb {
		background-color: var(--color-border);
		border-radius: 20px;
	}

	.category-section {
		margin-bottom: 1rem;
	}

	/* ScrollSpy targets need to be relative for offset calculation if needed, 
	   but simple scrolling works fine without position relative on sections */

	.category-header {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		margin-bottom: 0.25rem;
		padding-left: 0.25rem;
		position: sticky;
		top: 0;
		user-select: none;
		background: #f8fafc;
		z-index: 1;
		padding-top: 0.25rem;
		padding-bottom: 0.25rem;
	}

	@media (prefers-color-scheme: dark) {
		.category-header {
			background: var(--color-bg-secondary);
		}
	}

	.emoji-grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 0.25rem;
	}

	.emoji-btn {
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		user-select: none;
		background: transparent;
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: background-color 0.15s;
		padding: 0;
	}

	.emoji-btn:hover {
		background: var(--color-bg-secondary);
		transform: scale(1.1);
	}

	.emoji-footer {
		display: flex;
		background: var(--color-bg-secondary);
		border-top: 1px solid var(--color-border);
		padding: 0.25rem;
		justify-content: space-around;
	}

	.footer-btn {
		padding: 0.5rem;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: var(--radius-sm);
		opacity: 0.6;
		font-size: 1.25rem;
		transition: all 0.2s;
		flex: 1;
		user-select: none;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.footer-btn:hover {
		opacity: 0.8;
		background: var(--color-bg);
	}

	.footer-btn.active {
		opacity: 1;
		background: #f8fafc;
		color: var(--color-primary);
		box-shadow: var(--shadow-sm);
	}

	@media (prefers-color-scheme: dark) {
		.footer-btn.active {
			background: var(--color-bg-secondary);
		}
	}

	@media (max-width: 480px) {
		.emoji-picker-content {
			width: 280px;
			height: 300px;
		}

		.emoji-grid {
			grid-template-columns: repeat(6, 1fr);
		}
	}
</style>
