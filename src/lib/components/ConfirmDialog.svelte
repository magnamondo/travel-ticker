<script lang="ts">
	type Props = {
		open: boolean;
		title?: string;
		message: string;
		confirmText?: string;
		cancelText?: string;
		variant?: 'danger' | 'warning' | 'default';
		onconfirm: () => void;
		oncancel: () => void;
	};

	let {
		open,
		title = 'Confirm',
		message,
		confirmText = 'Confirm',
		cancelText = 'Cancel',
		variant = 'default',
		onconfirm,
		oncancel
	}: Props = $props();

	$effect(() => {
		if (open) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			oncancel();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			oncancel();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="dialog-overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby="dialog-title"
		aria-describedby="dialog-message"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div class="dialog-content">
			<h2 id="dialog-title" class="dialog-title">{title}</h2>
			<p id="dialog-message" class="dialog-message">{message}</p>
			<div class="dialog-actions">
				<button type="button" class="btn btn-secondary" onclick={oncancel}>
					{cancelText}
				</button>
				<button
					type="button"
					class="btn btn-primary"
					class:btn-danger={variant === 'danger'}
					class:btn-warning={variant === 'warning'}
					onclick={onconfirm}
				>
					{confirmText}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.dialog-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.dialog-content {
		background: #1a1a1a;
		border-radius: 12px;
		padding: 1.5rem;
		max-width: 400px;
		width: 100%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		animation: slideUp 0.2s ease-out;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.dialog-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: #fff;
		margin-bottom: 0.5rem;
	}

	.dialog-message {
		font-size: 0.9375rem;
		color: #aaa;
		line-height: 1.5;
		margin-bottom: 1.5rem;
	}

	.dialog-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	.btn {
		padding: 0.625rem 1.25rem;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		border: none;
		transition: all 0.15s ease;
	}

	.btn-secondary {
		background: #333;
		color: #fff;
	}

	.btn-secondary:hover {
		background: #444;
	}

	.btn-primary {
		background: #3b82f6;
		color: #fff;
	}

	.btn-primary:hover {
		background: #2563eb;
	}

	.btn-danger {
		background: #dc2626;
	}

	.btn-danger:hover {
		background: #b91c1c;
	}

	.btn-warning {
		background: #f59e0b;
		color: #000;
	}

	.btn-warning:hover {
		background: #d97706;
	}
</style>
