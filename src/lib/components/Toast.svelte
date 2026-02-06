<script lang="ts">
	import { toasts, type Toast } from '$lib/stores/toast.svelte';
	import { fly, fade } from 'svelte/transition';
</script>

{#if toasts.toasts.length > 0}
	<div class="toast-container">
		{#each toasts.toasts as toast (toast.id)}
			<div
				class="toast toast-{toast.type}"
				role="alert"
				in:fly={{ y: 50, duration: 200 }}
				out:fade={{ duration: 150 }}
			>
				<span class="toast-icon">
					{#if toast.type === 'success'}✓{:else if toast.type === 'error'}✕{:else}ℹ{/if}
				</span>
				<span class="toast-message">{toast.message}</span>
				<button
					class="toast-close"
					onclick={() => toasts.remove(toast.id)}
					aria-label="Dismiss"
				>×</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		bottom: 1.5rem;
		right: 1.5rem;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 400px;
		width: calc(100vw - 3rem);
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-radius: var(--radius-md);
		background: var(--color-bg-elevated);
		box-shadow: var(--shadow-lg);
		border-left: 4px solid;
	}

	.toast-success {
		border-left-color: var(--color-success, #10b981);
	}

	.toast-error {
		border-left-color: var(--color-error, #ef4444);
	}

	.toast-info {
		border-left-color: var(--color-primary, #3b82f6);
	}

	.toast-icon {
		font-size: 1rem;
		font-weight: 600;
		flex-shrink: 0;
	}

	.toast-success .toast-icon {
		color: var(--color-success, #10b981);
	}

	.toast-error .toast-icon {
		color: var(--color-error, #ef4444);
	}

	.toast-info .toast-icon {
		color: var(--color-primary, #3b82f6);
	}

	.toast-message {
		flex: 1;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.toast-close {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: background 0.15s, color 0.15s;
	}

	.toast-close:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	@media (max-width: 480px) {
		.toast-container {
			bottom: 1rem;
			right: 1rem;
			left: 1rem;
			width: auto;
			max-width: none;
		}
	}
</style>
