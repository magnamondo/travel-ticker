<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import EmojiPicker from './EmojiPicker.svelte';

	type ReactionCount = {
		emoji: string;
		count: number;
		userReacted: boolean;
	};

	let {
		reactions = [],
		targetType,
		targetId,
		isLoggedIn = false,
		canReact = false,
		onReact
	}: {
		reactions: ReactionCount[];
		targetType: 'milestone' | 'comment';
		targetId: string;
		isLoggedIn?: boolean;
		canReact?: boolean;
		onReact?: (emoji: string) => void;
	} = $props();

	const availableEmojis = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
	let showFullPicker = $state(false);
	let showPicker = $state(false);

	function redirectToLogin() {
		const redirectTo = encodeURIComponent(page.url.pathname);
		goto(`${resolve('/login')}?redirectTo=${redirectTo}`);
	}

	function handleReaction(emoji: string) {
		showFullPicker = false;
		showPicker = false;
		onReact?.(emoji);
	}

	function handleBadgeClick(emoji: string) {
		if (!isLoggedIn) {
			redirectToLogin();
			return;
		}
		if (canReact) {
			handleReaction(emoji);
		}
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
			showFullPicker = false;
		if (!target.closest('.reaction-picker-container') && !target.closest('.emoji-picker-overlay')) {
			showPicker = false;
		}
	}

	function getButtonTitle(reaction: ReactionCount): string {
		if (!isLoggedIn) return 'Log in to react';
		if (!canReact) return 'You cannot add reactions';
		return `${reaction.count} reaction${reaction.count !== 1 ? 's' : ''}`;
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="reactions-container">
	{#if reactions.length > 0}
		<div class="reactions-list">
			{#each reactions as reaction (reaction.emoji)}
				<button
					type="button"
					class="reaction-badge"
					class:user-reacted={reaction.userReacted}
					class:interactive={isLoggedIn && canReact}
					onclick={() => handleBadgeClick(reaction.emoji)}
					title={getButtonTitle(reaction)}
				>
					<span class="emoji">{reaction.emoji}</span>
					<span class="count">{reaction.count}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if canReact || !isLoggedIn}
		<div class="reaction-picker-container">
			<button
				type="button"
				class="add-reaction-btn"
				onclick={(e) => { 
					e.preventDefault(); 
					e.stopPropagation(); 
					if (!isLoggedIn) {
						redirectToLogin();
					} else {
						showPicker = !showPicker;
					}
				}}
				title={isLoggedIn ? "Add reaction" : "Log in to react"}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10"/>
					<path d="M8 14s1.5 2 4 2 4-2 4-2"/>
					<line x1="9" y1="9" x2="9.01" y2="9"/>
					<line x1="15" y1="9" x2="15.01" y2="9"/>
				</svg>
				<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19"/>
					<line x1="5" y1="12" x2="19" y2="12"/>
				</svg>
			</button>

			{#if showPicker}
				<div class="emoji-picker-overlay" onclick={() => {showPicker = false; showFullPicker = false;}} role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Enter') {showPicker = false; showFullPicker = false;} }}></div>
				<div class="emoji-picker">
					{#if showFullPicker}
						<EmojiPicker onselect={handleReaction} />
					{:else}
						{#each availableEmojis as emoji}
							<button
								type="button"
								class="emoji-option"
								onclick={(e) => { e.preventDefault(); e.stopPropagation(); handleReaction(emoji); }}
							>
								{emoji}
							</button>
						{/each}
						
						<button
							type="button"
							class="emoji-option expand-btn"
							onclick={(e) => { e.preventDefault(); e.stopPropagation(); showFullPicker = true; }}
							title="More emojis"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="12" y1="5" x2="12" y2="19"/>
								<line x1="5" y1="12" x2="19" y2="12"/>
							</svg>
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.reactions-container {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.reactions-list {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.reaction-badge {
		display: inline-flex;
		align-items: center;
		height: 26px;
		gap: 0.25rem;
		padding: 0 0.5rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		line-height: 1;
		cursor: default;
		transition: all 0.15s;
	}

	.reaction-badge.interactive {
		cursor: pointer;
	}

	.reaction-badge.interactive:hover {
		border-color: var(--color-primary);
		background: var(--color-primary-light);
	}

	.reaction-badge.user-reacted {
		border-color: var(--color-primary);
		background: var(--color-primary-light);
	}

	.reaction-badge .emoji {
		font-size: 0.875rem;
		line-height: 1;
	}

	.reaction-badge .count {
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.reaction-picker-container {
		position: relative;
	}

	.emoji-picker-overlay {
		display: none;
	}

	.add-reaction-btn {
		display: flex;
		align-items: center;
		height: 26px;
		gap: 0.25rem;
		padding: 0 0.5rem;
		background: transparent;
		background-color: rgba(255, 255, 255, 0.05); /* Ensure tap target is filled */
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
		-webkit-appearance: none;
		appearance: none;
	}

	.add-reaction-btn:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.emoji-picker {
		position: absolute;
		bottom: 100%;
		left: 0;
		margin-bottom: 0.5rem;
		display: flex;
		gap: 0.25rem;
		padding: 0.5rem;
		background: #f8fafc;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		z-index: 10;
	}
	
	@media (prefers-color-scheme: dark) {
		.emoji-picker {
			background: var(--color-bg-secondary);
		}
	}

	.expand-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
	}

	.expand-btn:hover {
		color: var(--color-primary);
		background: var(--color-bg);
	}

	.emoji-option {
		padding: 0.375rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 1.25rem;
		cursor: pointer;
		transition: background-color 0.15s;
		line-height: 1;
	}

	.emoji-option:hover {
		background: var(--color-bg);
	}

	@media (max-width: 480px) {
		.emoji-picker-overlay {
			display: block;
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.2);
			z-index: 999;
			backdrop-filter: blur(2px);
		}

		.emoji-picker {
			position: fixed;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			bottom: auto;
			margin: 0;
			z-index: 1000;
		}
	}
</style>
