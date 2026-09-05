<script lang="ts">
	import logo from '$lib/assets/favicon.svg';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import { resolve } from '$app/paths';

	interface Props {
		/** True once the tall header has faded out and the bar takes over. */
		docked: boolean;
		/** 0-1 read position through the document. */
		progress: number;
		originLabel?: string | null;
		destinationLabel?: string | null;
		/** Shown instead of the route when the ticker has no origin/destination. */
		fallbackLabel: string;
		/** Date of the entry currently nearest the top of the viewport. */
		currentDate?: string;
		user: { email: string; isAdmin: boolean } | null;
	}

	let { docked, progress, originLabel, destinationLabel, fallbackLabel, currentDate, user }: Props =
		$props();
</script>

<div class="ticker-topbar" class:is-docked={docked}>
	<div class="topbar-inner">
		<a href={resolve('/')} class="topbar-back">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M19 12H5M12 19l-7-7 7-7" />
			</svg>
			All tickers
		</a>

		<span class="topbar-divider" aria-hidden="true"></span>

		<img src={logo} alt="" class="topbar-mark" />

		<span class="topbar-route">
			{#if originLabel && destinationLabel}
				<span>{originLabel}</span>
				<span class="topbar-route-rule" aria-hidden="true"></span>
				<span>{destinationLabel}</span>
			{:else}
				<span>{fallbackLabel}</span>
			{/if}
		</span>

		<div class="topbar-progress">
			<div class="topbar-track">
				<div class="topbar-fill" style="width: {progress * 100}%"></div>
			</div>
			{#if currentDate}
				<span class="topbar-date">{currentDate}</span>
			{/if}
		</div>

		<div class="topbar-user">
			<UserMenu {user} />
		</div>
	</div>
</div>

<style>
	.ticker-topbar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 58px;
		z-index: 900;
		background: color-mix(in srgb, var(--color-bg) 88%, transparent);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		border-bottom: 1px solid transparent;
		/* Parked above the viewport until handover. */
		transform: translateY(-70px);
		opacity: 0;
		visibility: hidden;
		transition:
			transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 220ms ease,
			visibility 0s linear 320ms;
	}

	.ticker-topbar.is-docked {
		transform: translateY(0);
		opacity: 1;
		visibility: visible;
		border-bottom-color: color-mix(in srgb, var(--color-text) 6%, transparent);
		box-shadow: 0 4px 18px color-mix(in srgb, var(--color-text) 5%, transparent);
		transition:
			transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 220ms ease,
			visibility 0s;
	}

	/* Matches .timeline-section's max-width and horizontal padding. */
	.topbar-inner {
		max-width: 900px;
		height: 100%;
		margin: 0 auto;
		padding: 0 1rem;
		display: flex;
		align-items: center;
		gap: 18px;
	}

	.topbar-back {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex: none;
		font-size: 14px;
		color: var(--color-text-secondary);
		text-decoration: none;
		white-space: nowrap;
		transition: color 0.2s;
	}

	.topbar-back:hover {
		color: var(--color-primary);
	}

	.topbar-divider {
		flex: none;
		width: 1px;
		height: 20px;
		background: color-mix(in srgb, var(--color-text) 10%, transparent);
	}

	/* The brand mark: the existing gradient logo, optically matched to a 17px
	   text mark (the glyph fills roughly half of its 110x110 viewBox). */
	.topbar-mark {
		flex: none;
		width: 24px;
		height: 24px;
	}

	.topbar-route {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		flex: none;
		font-size: 12px;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.topbar-route-rule {
		width: 26px;
		height: 1px;
		background: var(--color-border-strong);
	}

	.topbar-progress {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex: 1 1 auto;
		min-width: 60px;
	}

	.topbar-track {
		flex: 1 1 auto;
		min-width: 0;
		height: 3px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-text) 10%, transparent);
		overflow: hidden;
	}

	.topbar-fill {
		height: 100%;
		border-radius: 999px;
		background: var(--color-accent);
		transition: width 120ms linear;
	}

	.topbar-date {
		flex: none;
		font-size: 11px;
		letter-spacing: 1.5px;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		text-transform: uppercase;
		white-space: nowrap;
	}

	/* Re-seat the existing user menu inside the bar: it is normally fixed to
	   the top right of the viewport, here it sits in the row at 30px. */
	.topbar-user {
		position: relative;
		flex: none;
		margin-left: auto;
	}

	.topbar-user :global(.user-menu-container) {
		position: static;
		top: auto;
		right: auto;
		z-index: auto;
	}

	.topbar-user :global(.user-menu-trigger) {
		width: 30px;
		height: 30px;
		border-width: 1px;
	}

	.topbar-user :global(.user-avatar) {
		font-size: 0.95rem;
	}

	.topbar-user :global(.ghost-avatar) {
		width: 20px;
		height: 20px;
	}

	/* While the bar is docked it owns the avatar, so the layout's fixed user
	   menu stands down; it is handed back only after the bar has faded out. */
	:global(:not(.topbar-user) > .user-menu-container) {
		transition:
			opacity 200ms ease 220ms,
			visibility 0s linear 220ms;
	}

	:global(body:has(.ticker-topbar.is-docked) :not(.topbar-user) > .user-menu-container) {
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 160ms ease,
			visibility 0s linear 160ms;
	}

	@media (max-width: 768px) {
		.topbar-inner {
			padding: 0 0.75rem;
		}
	}

	/* Keep the back link, mark, progress and avatar; the route pair and its
	   divider go so the progress track keeps room. */
	@media (max-width: 560px) {
		.topbar-inner {
			gap: 12px;
		}

		.topbar-divider,
		.topbar-route {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ticker-topbar,
		.ticker-topbar.is-docked {
			transition: none;
		}

		.topbar-fill {
			transition: none;
		}
	}
</style>
