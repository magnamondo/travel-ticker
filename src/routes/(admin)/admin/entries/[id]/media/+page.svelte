<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ChunkedUploader from '$lib/components/ChunkedUploader.svelte';
	import type { UploadResult } from '$lib/upload';

	let { data, form } = $props();
	
	let showUploader = $state(false);
	let showUrlForm = $state(false);

	async function handleUploadComplete(result: UploadResult) {
		// Create a form and submit it to add the media
		const mediaType = result.mimeType.startsWith('video/') ? 'video' : 'image';
		
		const formData = new FormData();
		formData.append('type', mediaType);
		formData.append('url', result.url);
		formData.append('thumbnailUrl', '');
		formData.append('caption', '');

		await fetch('?/add', {
			method: 'POST',
			body: formData
		});

		showUploader = false;
		await invalidateAll();
	}
</script>

<div class="media-page">
	<div class="page-header">
		<a href="/admin/entries" class="back-link">← Back to entries</a>
		<h1>Media for: {data.milestone.title}</h1>
	</div>

	{#if form?.error}
		<div class="error">{form.error}</div>
	{/if}

	<div class="media-grid">
		{#each data.media as item (item.id)}
			<div class="media-item">
				{#if item.type === 'video'}
					<div class="media-thumbnail video">
						{#if item.thumbnailUrl}
							<img src={item.thumbnailUrl} alt="" />
						{:else}
							<div class="video-placeholder">🎬</div>
						{/if}
						<span class="play-icon">▶</span>
					</div>
				{:else}
					<img src={item.url} alt="" class="media-thumbnail" />
				{/if}
				<div class="media-info">
					<span class="media-type">{item.type}</span>
					{#if item.caption}
						<span class="media-caption">{item.caption}</span>
					{/if}
				</div>
				<form method="POST" action="?/delete" use:enhance>
					<input type="hidden" name="mediaId" value={item.id} />
					<button type="submit" class="btn-delete">×</button>
				</form>
			</div>
		{:else}
			<p class="empty">No media attached yet.</p>
		{/each}
	</div>

	<div class="add-media-section">
		<h2>Add Media</h2>
		
		<div class="add-options">
			<button 
				type="button" 
				class="option-btn" 
				class:active={showUploader}
				onclick={() => { showUploader = true; showUrlForm = false; }}
			>
				📤 Upload File
			</button>
			<button 
				type="button" 
				class="option-btn" 
				class:active={showUrlForm}
				onclick={() => { showUrlForm = true; showUploader = false; }}
			>
				🔗 Add by URL
			</button>
		</div>

		{#if showUploader}
			<div class="uploader-container">
				<ChunkedUploader 
					milestoneId={data.milestone.id}
					accept="image/*,video/*"
					onUploadComplete={handleUploadComplete}
				/>
			</div>
		{:else if showUrlForm}
			<form method="POST" action="?/add" use:enhance class="add-form">
				<div class="form-row">
					<div class="form-field">
						<label for="type">Type</label>
						<select id="type" name="type" required>
							<option value="image">Image</option>
							<option value="video">Video</option>
						</select>
					</div>
					<div class="form-field flex-1">
						<label for="url">URL</label>
						<input type="url" id="url" name="url" required placeholder="https://..." />
					</div>
				</div>
				<div class="form-row">
					<div class="form-field flex-1">
						<label for="thumbnailUrl">Thumbnail URL (for videos)</label>
						<input type="url" id="thumbnailUrl" name="thumbnailUrl" placeholder="https://..." />
					</div>
					<div class="form-field flex-1">
						<label for="caption">Caption</label>
						<input type="text" id="caption" name="caption" placeholder="Optional caption" />
					</div>
				</div>
				<button type="submit" class="btn-primary">Add Media</button>
			</form>
		{:else}
			<p class="hint">Choose an option above to add media</p>
		{/if}
	</div>
</div>

<style>
	.media-page {
		max-width: 800px;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.back-link {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		text-decoration: none;
		display: block;
		margin-bottom: 0.5rem;
	}

	.back-link:hover {
		color: var(--color-text);
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.error {
		padding: 0.75rem;
		background: var(--color-error);
		color: white;
		border-radius: var(--radius-md);
		margin-bottom: 1rem;
	}

	.media-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.media-item {
		position: relative;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.media-thumbnail {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
	}

	.media-thumbnail.video {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-secondary);
	}

	.media-thumbnail.video img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.video-placeholder {
		font-size: 3rem;
	}

	.play-icon {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 1.5rem;
		color: white;
		text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
	}

	.media-info {
		padding: 0.5rem;
	}

	.media-type {
		font-size: 0.625rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}

	.media-caption {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin-top: 0.25rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.btn-delete {
		position: absolute;
		top: 0.25rem;
		right: 0.25rem;
		width: 24px;
		height: 24px;
		border: none;
		background: rgba(0, 0, 0, 0.5);
		color: white;
		border-radius: 50%;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
	}

	.btn-delete:hover {
		background: var(--color-error);
	}

	.empty {
		grid-column: 1 / -1;
		text-align: center;
		color: var(--color-text-muted);
		padding: 2rem;
	}

	.add-media-section {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		padding: 1.5rem;
	}

	.add-media-section h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 1rem;
	}

	.add-options {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.option-btn {
		flex: 1;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: 0.9375rem;
		color: var(--color-text-secondary);
		transition: all 0.2s ease;
	}

	.option-btn:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.option-btn.active {
		border-color: var(--color-primary);
		background: var(--color-primary-light);
		color: var(--color-primary);
	}

	.uploader-container {
		margin-top: 1rem;
	}

	.hint {
		text-align: center;
		color: var(--color-text-muted);
		font-style: italic;
		padding: 2rem;
	}

	.add-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.form-row {
		display: flex;
		gap: 1rem;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.form-field.flex-1 {
		flex: 1;
	}

	label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	input,
	select {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.875rem;
	}

	input:focus,
	select:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.btn-primary {
		padding: 0.75rem 1.5rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 500;
		cursor: pointer;
		align-self: flex-start;
	}

	/* Mobile styles */
	@media (max-width: 768px) {
		.media-page {
			max-width: 100%;
		}

		h1 {
			font-size: 1.25rem;
		}

		.media-grid {
			grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
			gap: 0.75rem;
		}

		.add-media-section {
			padding: 1rem;
		}

		.form-row {
			flex-direction: column;
		}

		.btn-primary {
			width: 100%;
			text-align: center;
		}
	}
</style>
