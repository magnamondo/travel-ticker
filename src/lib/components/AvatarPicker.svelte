<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import ChunkedUploader from './ChunkedUploader.svelte';
	import type { UploadResult } from '$lib/upload';

	interface Props {
		value?: string | null;
		availableImages?: string[];
		onchange?: (url: string | null) => void;
	}

	let {
		value = null,
		availableImages = [],
		onchange
	}: Props = $props();

	let showUploader = $state(false);
	let showPicker = $state(false);

	function selectImage(url: string) {
		onchange?.(url);
		showPicker = false;
	}

	function clearAvatar() {
		onchange?.(null);
	}

	async function handleUploadComplete(result: UploadResult) {
		onchange?.(result.url);
		showUploader = false;
		// Refresh page data to include new upload in available images
		await invalidateAll();
	}
</script>

<div class="avatar-picker">
	{#if value}
		<div class="current-avatar">
			<img src={value} alt="Current avatar" class="avatar-preview" />
			<div class="avatar-actions">
				<button type="button" class="btn-change" onclick={() => showPicker = true}>
					Change
				</button>
				<button type="button" class="btn-remove" onclick={clearAvatar}>
					Remove
				</button>
			</div>
		</div>
	{:else}
		<div class="no-avatar">
			<div class="avatar-placeholder">
				<span>No avatar</span>
			</div>
			<button type="button" class="btn-add" onclick={() => showPicker = true}>
				+ Add Avatar
			</button>
		</div>
	{/if}

	{#if showPicker}
		<div class="picker-overlay" onclick={() => showPicker = false} role="presentation"></div>
		<div class="picker-modal">
			<div class="picker-header">
				<h3>Select Avatar</h3>
				<button type="button" class="btn-close" onclick={() => showPicker = false}>×</button>
			</div>

			<div class="picker-options">
				<button
					type="button"
					class="option-btn"
					class:active={showUploader}
					onclick={() => showUploader = !showUploader}
				>
					📤 Upload New
				</button>
			</div>

			{#if showUploader}
				<div class="uploader-container">
					<ChunkedUploader
						accept="image/*"
						maxSize={10 * 1024 * 1024}
						onUploadComplete={handleUploadComplete}
					/>
				</div>
			{/if}

			{#if availableImages.length > 0}
				<div class="available-images">
					<h4>Or select from uploads</h4>
					<div class="image-grid">
						{#each availableImages as imageUrl (imageUrl)}
							<button
								type="button"
								class="image-option"
								class:selected={value === imageUrl}
								onclick={() => selectImage(imageUrl)}
							>
								<img src={imageUrl} alt="" />
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<input type="hidden" name="avatar" value={value || ''} />
</div>

<style>
	.avatar-picker {
		position: relative;
	}

	.current-avatar {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.avatar-preview {
		width: 80px;
		height: 80px;
		border-radius: var(--radius-full);
		object-fit: cover;
		border: 2px solid var(--color-border);
	}

	.avatar-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.no-avatar {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.avatar-placeholder {
		width: 80px;
		height: 80px;
		border-radius: var(--radius-full);
		background: var(--color-bg-secondary);
		border: 2px dashed var(--color-border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.btn-add, .btn-change {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.btn-add:hover, .btn-change:hover {
		background: var(--color-primary-hover);
	}

	.btn-remove {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		background: transparent;
		color: var(--color-error);
		border: 1px solid var(--color-error);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.btn-remove:hover {
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
	}

	.picker-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 100;
	}

	.picker-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: var(--color-bg-elevated);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 1.5rem;
		z-index: 101;
		max-width: 500px;
		width: 90vw;
		max-height: 80vh;
		overflow-y: auto;
	}

	.picker-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.picker-header h3 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.btn-close {
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		color: var(--color-text-muted);
		padding: 0;
		line-height: 1;
	}

	.btn-close:hover {
		color: var(--color-text);
	}

	.picker-options {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.option-btn {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 0.2s;
	}

	.option-btn:hover {
		border-color: var(--color-primary);
	}

	.option-btn.active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.uploader-container {
		margin-bottom: 1rem;
		padding: 1rem;
		background: var(--color-bg);
		border-radius: var(--radius-md);
	}

	.available-images {
		border-top: 1px solid var(--color-border);
		padding-top: 1rem;
	}

	.available-images h4 {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-muted);
		margin: 0 0 0.75rem 0;
	}

	.image-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
		gap: 0.5rem;
	}

	.image-option {
		padding: 0;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: none;
		cursor: pointer;
		overflow: hidden;
		aspect-ratio: 1;
		transition: border-color 0.2s, transform 0.2s;
	}

	.image-option:hover {
		border-color: var(--color-primary);
		transform: scale(1.05);
	}

	.image-option.selected {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px var(--color-primary);
	}

	.image-option img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
</style>
