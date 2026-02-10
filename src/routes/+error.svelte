<script lang="ts">
	import { page } from '$app/stores';
</script>

<svelte:head>
	<title>Error {$page.status} | Travel Ticker</title>
</svelte:head>

<div class="error-page">
	<div class="error-content">
		<div class="compass">
			<svg viewBox="0 0 100 100" class="compass-svg">
				<circle cx="50" cy="50" r="45" fill="none" stroke="var(--color-border-strong)" stroke-width="2"/>
				<circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-border)" stroke-width="1"/>
				<!-- Cardinal directions -->
				<text x="50" y="12" text-anchor="middle" class="direction">N</text>
				<text x="92" y="54" text-anchor="middle" class="direction">E</text>
				<text x="50" y="96" text-anchor="middle" class="direction">S</text>
				<text x="8" y="54" text-anchor="middle" class="direction">W</text>
				<!-- Compass needle -->
				<g class="needle">
					<polygon points="50,15 45,50 55,50" fill="var(--color-error)"/>
					<polygon points="50,85 45,50 55,50" fill="var(--color-text-muted)"/>
					<circle cx="50" cy="50" r="5" fill="var(--color-bg-elevated)" stroke="var(--color-border-strong)" stroke-width="2"/>
				</g>
			</svg>
		</div>

		<h1 class="error-code">{$page.status}</h1>

		<h2 class="error-title">
			{#if $page.status === 404}
				Lost in Transit
			{:else if $page.status === 500}
				Unexpected Bumps
			{:else}
				Off the Map
			{/if}
		</h2>

		<p class="error-message">
			{#if $page.status === 404}
				The destination you're looking for doesn't exist on our itinerary.
			{:else if $page.error?.message}
				{$page.error.message}
			{:else}
				Something went wrong on this journey.
			{/if}
		</p>

		<a href="/" class="home-button">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
				<polyline points="9 22 9 12 15 12 15 22"/>
			</svg>
			Back to Timeline
		</a>
	</div>

	<div class="decorative-elements">
		<div class="plane"></div>
		<div class="dotted-path"></div>
	</div>
</div>

<style>
	.error-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		position: relative;
		overflow: hidden;
	}

	.error-content {
		text-align: center;
		max-width: 500px;
		z-index: 1;
	}

	.compass {
		width: 120px;
		height: 120px;
		margin: 0 auto 2rem;
		animation: float 3s ease-in-out infinite;
	}

	.compass-svg {
		width: 100%;
		height: 100%;
	}

	.direction {
		font-size: 10px;
		font-weight: 600;
		fill: var(--color-text-muted);
	}

	.needle {
		transform-origin: 50% 50%;
		animation: spin 8s linear infinite;
	}

	@keyframes float {
		0%, 100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-10px);
		}
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		25% {
			transform: rotate(90deg);
		}
		50% {
			transform: rotate(180deg);
		}
		75% {
			transform: rotate(270deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	.error-code {
		font-size: 8rem;
		font-weight: 800;
		line-height: 1;
		color: var(--color-primary);
		margin-bottom: 0.5rem;
		text-shadow:
			2px 2px 0 var(--color-border),
			4px 4px 0 var(--color-bg-elevated);
	}

	.error-title {
		font-size: 1.75rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 1rem;
	}

	.error-message {
		font-size: 1.1rem;
		color: var(--color-text-secondary);
		margin-bottom: 2.5rem;
		line-height: 1.6;
	}

	.home-button {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1.75rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-full);
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: var(--shadow-md);
	}

	.home-button:hover {
		background: var(--color-primary-hover);
		transform: translateY(-2px);
		box-shadow: var(--shadow-lg);
	}

	.home-button svg {
		flex-shrink: 0;
	}

	.decorative-elements {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.plane {
		position: absolute;
		top: 20%;
		right: -50px;
		width: 40px;
		height: 40px;
		opacity: 0.15;
		animation: fly 20s linear infinite;
	}

	.plane::before {
		content: '';
		position: absolute;
		width: 0;
		height: 0;
		border-left: 20px solid var(--color-text);
		border-top: 10px solid transparent;
		border-bottom: 10px solid transparent;
	}

	.plane::after {
		content: '';
		position: absolute;
		top: 5px;
		left: -15px;
		width: 15px;
		height: 10px;
		background: var(--color-text);
		clip-path: polygon(0 50%, 100% 0, 100% 100%);
	}

	@keyframes fly {
		0% {
			transform: translateX(0) translateY(0);
		}
		100% {
			transform: translateX(calc(-100vw - 100px)) translateY(30vh);
		}
	}

	.dotted-path {
		position: absolute;
		top: 25%;
		right: 0;
		width: 100%;
		height: 200px;
		opacity: 0.1;
		background: repeating-linear-gradient(
			90deg,
			var(--color-text) 0,
			var(--color-text) 10px,
			transparent 10px,
			transparent 20px
		);
		background-size: 20px 2px;
		background-repeat: no-repeat;
		transform: rotate(10deg);
	}

	@media (max-width: 768px) {
		.error-code {
			font-size: 5rem;
		}

		.error-title {
			font-size: 1.5rem;
		}

		.error-message {
			font-size: 1rem;
		}

		.compass {
			width: 100px;
			height: 100px;
		}
	}
</style>
