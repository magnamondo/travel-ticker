<script lang="ts">
	let { children } = $props();
	let menuOpen = $state(false);
</script>

<svelte:head>
	<title>Admin / Magnamondo</title>
</svelte:head>

<div class="admin-layout">
	<header class="admin-header-mobile">
		<button class="menu-toggle" onclick={() => (menuOpen = !menuOpen)} aria-label="Toggle menu">
			{#if menuOpen}✕{:else}☰{/if}
		</button>
		<h2>Admin</h2>
		<a href="/" class="back-link">← Site</a>
	</header>
	
	<aside class="admin-sidebar" class:open={menuOpen}>
		<div class="admin-logo">
			<h2>Admin</h2>
		</div>
		<nav class="admin-nav">
			<a href="/admin" onclick={() => (menuOpen = false)}>Dashboard</a>
			<a href="/admin/entries" onclick={() => (menuOpen = false)}>Entries</a>
			<a href="/admin/users" onclick={() => (menuOpen = false)}>Users</a>
			<a href="/admin/groups" onclick={() => (menuOpen = false)}>Groups</a>
			<a href="/admin/comments" onclick={() => (menuOpen = false)}>Comments</a>
			<a href="/admin/jobs" onclick={() => (menuOpen = false)}>Video Jobs</a>
			<a href="/admin/notifications" onclick={() => (menuOpen = false)}>Notifications</a>
		</nav>
		<div class="admin-back">
			<a href="/">← Back to site</a>
		</div>
	</aside>
	
	{#if menuOpen}
		<button class="overlay" onclick={() => (menuOpen = false)} aria-label="Close menu"></button>
	{/if}
	
	<main class="admin-main">
		{@render children()}
	</main>
</div>

<style>
	.admin-layout {
		display: flex;
		min-height: 100vh;
	}

	.admin-header-mobile {
		display: none;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		padding: 0 1rem;
		align-items: center;
		justify-content: space-between;
		z-index: 100;
	}

	.admin-header-mobile h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.menu-toggle {
		width: 40px;
		height: 40px;
		background: transparent;
		border: none;
		font-size: 1.5rem;
		color: var(--color-text);
		cursor: pointer;
	}

	.admin-header-mobile .back-link {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.admin-sidebar {
		width: 240px;
		background: var(--color-bg-secondary);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		padding: 1.5rem;
		position: sticky;
		top: 0;
		height: 100vh;
		overflow-y: auto;
	}

	.admin-logo h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 2rem;
	}

	.admin-nav {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
	}

	.admin-nav a {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		text-decoration: none;
		transition: background 0.15s, color 0.15s;
	}

	.admin-nav a:hover {
		background: var(--color-bg-elevated);
		color: var(--color-text);
	}

	.admin-back {
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	.admin-back a {
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.875rem;
	}

	.admin-back a:hover {
		color: var(--color-text);
	}

	.admin-main {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
	}

	.overlay {
		display: none;
	}

	@media (max-width: 768px) {
		.admin-header-mobile {
			display: flex;
		}

		.admin-sidebar {
			position: fixed;
			top: 0;
			left: 0;
			bottom: 0;
			z-index: 200;
			transform: translateX(-100%);
			transition: transform 0.2s ease-out;
		}

		.admin-sidebar.open {
			transform: translateX(0);
		}

		.overlay {
			display: block;
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.5);
			z-index: 150;
		}

		.admin-main {
			padding: 1rem;
			margin-top: 56px;
		}
	}
</style>
