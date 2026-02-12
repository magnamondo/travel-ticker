<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	interface Props {
		user: {
			email: string;
			isAdmin: boolean;
		} | null;
		logoutAction?: string;
	}

	let { user, logoutAction = '/?/logout' }: Props = $props();

	let userMenuOpen = $state(false);

	function toggleUserMenu(e: MouseEvent | TouchEvent) {
		e.preventDefault();
		e.stopPropagation();
		userMenuOpen = !userMenuOpen;
	}

	function closeUserMenu(e: MouseEvent | TouchEvent) {
		e.preventDefault();
		e.stopPropagation();
		userMenuOpen = false;
	}
</script>

{#if user}
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
					<span class="user-email">{user.email}</span>
				</div>
				<div class="user-menu-items">
					{#if user.isAdmin}
						<a href={resolve("/admin")} class="user-menu-item" onclick={() => userMenuOpen = false}>
							<span class="menu-icon">⚙️</span>
							<span>Admin</span>
						</a>
					{/if}
					<a href={resolve("/profile")} class="user-menu-item" onclick={() => userMenuOpen = false}>
						<span class="menu-icon">👤</span>
						<span>Profile</span>
					</a>
					<form method="post" action={logoutAction} use:enhance class="user-menu-form">
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

<style>
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
		transform: translateZ(0);
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
</style>
