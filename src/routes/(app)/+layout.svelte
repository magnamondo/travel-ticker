<script lang="ts">
	import '../../app.css';
	import { resolve } from '$app/paths';
	import logo from '$lib/assets/favicon.svg';

	let { children, data } = $props();
</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="app-layout">
	<header class="app-header">
		<a href={resolve("/")} class="header-logo">
			<img src={logo} alt="Magnamondo" />
		</a>
		<nav class="header-nav">
			{#if data.user?.isAdmin}
				<a href={resolve("/admin")} class="nav-link">Admin</a>
			{/if}
			<a href={resolve("/profile")} class="nav-link">Profile</a>
			<a href={resolve("/")} class="nav-link">← Back</a>
		</nav>
	</header>
	<main class="app-main">
		{@render children()}
	</main>
</div>

<style>
	.app-layout {
		min-height: 100vh;
		background-color: var(--color-bg);
		color: var(--color-text);
	}

	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 2rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.header-logo {
		width: 48px;
		height: 48px;
		transform: scaleX(-1);
	}

	.header-logo img {
		width: 100%;
		height: 100%;
	}

	.header-nav {
		display: flex;
		gap: 1.5rem;
	}

	.nav-link {
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 500;
		transition: color 0.2s;
	}

	.nav-link:hover {
		color: var(--color-primary);
	}

	.app-main {
		max-width: 600px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	@media (max-width: 600px) {
		.app-header {
			padding: 1rem;
		}

		.header-logo {
			width: 40px;
			height: 40px;
		}

		.app-main {
			padding: 1.5rem 1rem;
		}
	}
</style>
