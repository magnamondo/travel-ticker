<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	type Ticker = (typeof data.tickers)[number];

	let { data, form } = $props();

	let lastToastMessage = $state<string | null>(null);

	$effect(() => {
		const message = form?.success ? form?.message : form?.error;
		const lastShown = untrack(() => lastToastMessage);

		if (message && message !== lastShown) {
			lastToastMessage = message;
			if (form?.success) {
				toasts.success(message);
			} else {
				toasts.error(message);
			}
		}
	});

	let showCreateModal = $state(false);
	let editingTicker = $state<Ticker | null>(null);
	let deletingTicker = $state<Ticker | null>(null);
	let deleteForm = $state<HTMLFormElement>();

	// Live slug preview for the create form, so the resulting URL is never a surprise.
	let createName = $state('');
	let createSlug = $state('');

	function slugPreview(name: string, slug: string): string {
		const source = slug || name;
		return (
			source
				.normalize('NFKD')
				.replace(/[\u0300-\u036f]/g, '')
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 64) || 'ticker'
		);
	}

	function openCreate() {
		createName = '';
		createSlug = '';
		showCreateModal = true;
	}

	function formatDate(date: Date | string | null) {
		if (!date) return '—';
		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(new Date(date));
	}

	function confirmDelete() {
		deleteForm?.requestSubmit();
		deletingTicker = null;
	}
</script>

<div class="tickers-page">
	<div class="page-header">
		<div>
			<h1>Tickers</h1>
			<p class="subtitle">Each ticker is its own timeline at /t/&lt;slug&gt;</p>
		</div>
		<button class="btn btn-primary" onclick={openCreate}>+ New ticker</button>
	</div>

	{#if data.tickers.length === 0}
		<div class="empty">
			<p>No tickers yet. Create one to start a timeline.</p>
		</div>
	{:else}
		<div class="ticker-list">
			{#each data.tickers as ticker (ticker.id)}
				<div class="ticker-row">
					<div class="ticker-thumb">
						{#if ticker.coverImage}
							<img src={ticker.coverImage} alt="" />
						{:else}
							<span aria-hidden="true">🧭</span>
						{/if}
					</div>

					<div class="ticker-info">
						<div class="ticker-title-row">
							<h2>{ticker.name}</h2>
							<span class="status" class:published={ticker.published}>
								{ticker.published ? 'Published' : 'Draft'}
							</span>
						</div>
						<a class="ticker-url" href={resolve(`/t/${ticker.slug}`)} target="_blank" rel="noopener">
							/t/{ticker.slug} ↗
						</a>
						{#if ticker.tagline}
							<p class="ticker-tagline">{ticker.tagline}</p>
						{/if}
						{#if ticker.originLabel || ticker.destinationLabel}
							<p class="ticker-route">
								{ticker.originLabel ?? '?'} → {ticker.destinationLabel ?? '?'}
							</p>
						{/if}
						<p class="ticker-meta">
							{ticker.segmentCount} segment{ticker.segmentCount === 1 ? '' : 's'} ·
							{ticker.entryCount} entr{ticker.entryCount === 1 ? 'y' : 'ies'} · created {formatDate(
								ticker.createdAt
							)}
						</p>
					</div>

					<div class="ticker-actions">
						<button class="btn btn-sm" onclick={() => (editingTicker = ticker)}>Edit</button>
						<form method="POST" action="?/togglePublished" use:enhance>
							<input type="hidden" name="tickerId" value={ticker.id} />
							<button type="submit" class="btn btn-sm">
								{ticker.published ? 'Unpublish' : 'Publish'}
							</button>
						</form>
						<button class="btn btn-sm btn-danger" onclick={() => (deletingTicker = ticker)}>
							Delete
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if showCreateModal}
	<div class="modal-overlay">
		<div class="modal">
			<h2>New ticker</h2>
			<form
				method="POST"
				action="?/addTicker"
				use:enhance={() => {
					return async ({ result, update }) => {
						await update();
						if (result.type === 'success') showCreateModal = false;
					};
				}}
			>
				<div class="form-group">
					<label for="create-name">Name *</label>
					<input id="create-name" name="name" bind:value={createName} required />
				</div>

				<div class="form-group">
					<label for="create-slug">Slug</label>
					<input
						id="create-slug"
						name="slug"
						bind:value={createSlug}
						placeholder="Leave blank to derive from the name"
					/>
					<p class="field-hint">URL: /t/{slugPreview(createName, createSlug)}</p>
				</div>

				<div class="form-row">
					<div class="form-group">
						<label for="create-origin">From</label>
						<input id="create-origin" name="originLabel" placeholder="" />
					</div>
					<div class="form-group">
						<label for="create-destination">To</label>
						<input id="create-destination" name="destinationLabel" placeholder="" />
					</div>
				</div>
				<p class="field-hint">Both are needed to show the arrow in the timeline header.</p>

				<div class="form-group">
					<label for="create-tagline">Tagline</label>
					<input id="create-tagline" name="tagline" placeholder="Travel Ticker" />
				</div>

				<div class="form-group">
					<label for="create-description">Description</label>
					<textarea id="create-description" name="description" rows="3"></textarea>
				</div>

				<div class="form-group">
					<label for="create-cover">Cover image</label>
					<select id="create-cover" name="coverImage">
						<option value="">None (use entry thumbnails)</option>
						{#each data.availableImages as image (image)}
							<option value={image}>{image.replace('/api/uploads/', '')}</option>
						{/each}
					</select>
				</div>

				<label class="checkbox-row">
					<input type="checkbox" name="published" />
					<span>Publish immediately</span>
				</label>

				<div class="modal-actions">
					<button type="button" class="btn" onclick={() => (showCreateModal = false)}>Cancel</button
					>
					<button type="submit" class="btn btn-primary">Create</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if editingTicker}
	<div class="modal-overlay">
		<div class="modal">
			<h2>Edit ticker</h2>
			<form
				method="POST"
				action="?/updateTicker"
				use:enhance={() => {
					return async ({ result, update }) => {
						await update();
						if (result.type === 'success') editingTicker = null;
					};
				}}
			>
				<input type="hidden" name="tickerId" value={editingTicker.id} />

				<div class="form-group">
					<label for="edit-name">Name *</label>
					<input id="edit-name" name="name" value={editingTicker.name} required />
				</div>

				<div class="form-group">
					<label for="edit-slug">Slug</label>
					<input id="edit-slug" name="slug" value={editingTicker.slug} />
					<p class="field-hint warning">
						Changing the slug changes the public URL. Existing links to /t/{editingTicker.slug} will stop
						working.
					</p>
				</div>

				<div class="form-row">
					<div class="form-group">
						<label for="edit-origin">From</label>
						<input id="edit-origin" name="originLabel" value={editingTicker.originLabel ?? ''} />
					</div>
					<div class="form-group">
						<label for="edit-destination">To</label>
						<input
							id="edit-destination"
							name="destinationLabel"
							value={editingTicker.destinationLabel ?? ''}
						/>
					</div>
				</div>

				<div class="form-group">
					<label for="edit-tagline">Tagline</label>
					<input id="edit-tagline" name="tagline" value={editingTicker.tagline ?? ''} />
				</div>

				<div class="form-group">
					<label for="edit-description">Description</label>
					<textarea id="edit-description" name="description" rows="3"
						>{editingTicker.description ?? ''}</textarea
					>
				</div>

				<div class="form-group">
					<label for="edit-cover">Cover image</label>
					<select id="edit-cover" name="coverImage" value={editingTicker.coverImage ?? ''}>
						<option value="">None (use entry thumbnails)</option>
						{#each data.availableImages as image (image)}
							<option value={image}>{image.replace('/api/uploads/', '')}</option>
						{/each}
					</select>
				</div>

				<label class="checkbox-row">
					<input type="checkbox" name="published" checked={editingTicker.published} />
					<span>Published</span>
				</label>

				<div class="modal-actions">
					<button type="button" class="btn" onclick={() => (editingTicker = null)}>Cancel</button>
					<button type="submit" class="btn btn-primary">Save</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if deletingTicker}
	<form
		method="POST"
		action="?/deleteTicker"
		bind:this={deleteForm}
		use:enhance
		class="hidden-form"
	>
		<input type="hidden" name="tickerId" value={deletingTicker.id} />
	</form>
{/if}

<ConfirmDialog
	open={!!deletingTicker}
	title="Delete ticker"
	message={deletingTicker
		? `Delete "${deletingTicker.name}"? This only works once all its segments have been removed.`
		: ''}
	confirmText="Delete"
	variant="danger"
	onconfirm={confirmDelete}
	oncancel={() => (deletingTicker = null)}
/>

<style>
	.tickers-page {
		padding: 2rem;
		max-width: 1200px;
		margin: 0 auto;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.subtitle {
		color: var(--color-text-secondary);
		font-size: 0.875rem;
	}

	.empty {
		padding: 3rem 1rem;
		text-align: center;
		color: var(--color-text-secondary);
		border: 1px dashed var(--color-border);
		border-radius: 8px;
	}

	.ticker-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.ticker-row {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
	}

	.ticker-thumb {
		flex: 0 0 96px;
		width: 96px;
		height: 64px;
		border-radius: 6px;
		overflow: hidden;
		background: var(--color-bg);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		opacity: 0.9;
	}

	.ticker-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.ticker-info {
		flex: 1;
		min-width: 0;
	}

	.ticker-title-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.ticker-title-row h2 {
		font-size: 1.05rem;
		font-weight: 600;
		margin: 0;
	}

	.status {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--color-accent-light);
		color: var(--color-text-secondary);
	}

	.status.published {
		background: var(--color-primary-light);
		color: var(--color-primary);
	}

	.ticker-url {
		display: inline-block;
		margin-top: 0.2rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--color-primary);
		text-decoration: none;
	}

	.ticker-url:hover {
		text-decoration: underline;
	}

	.ticker-tagline,
	.ticker-route,
	.ticker-meta {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
	}

	.ticker-meta {
		color: var(--color-text-muted);
	}

	.ticker-actions {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: stretch;
	}

	.ticker-actions form {
		display: contents;
	}

	.hidden-form {
		display: none;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.modal {
		background: var(--color-bg);
		border-radius: 8px;
		padding: 1.5rem;
		width: 100%;
		max-width: 520px;
		max-height: 90vh;
		overflow-y: auto;
	}

	.modal h2 {
		font-size: 1.25rem;
		margin-bottom: 1rem;
	}

	.form-group {
		margin-bottom: 1rem;
		flex: 1;
	}

	.form-row {
		display: flex;
		gap: 0.75rem;
	}

	.form-group label {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		margin-bottom: 0.25rem;
	}

	.form-group input,
	.form-group textarea,
	.form-group select {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	.field-hint {
		margin: 0.3rem 0 1rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.field-hint.warning {
		color: var(--color-warning);
		font-family: inherit;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.checkbox-row input {
		width: auto;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.5rem;
	}

	/* Buttons */
	.btn {
		padding: 0.5rem 1rem;
		border-radius: 4px;
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		cursor: pointer;
		font-size: 0.875rem;
		white-space: nowrap;
	}

	.btn:hover {
		border-color: var(--color-border-strong);
	}

	.btn-primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}

	.btn-primary:hover {
		opacity: 0.9;
	}

	.btn-danger {
		background: var(--color-danger);
		border-color: var(--color-danger);
		color: white;
	}

	.btn-sm {
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
	}

	@media (max-width: 768px) {
		.tickers-page {
			padding: 1rem;
		}

		.ticker-row {
			flex-wrap: wrap;
		}

		.ticker-actions {
			flex-direction: row;
			width: 100%;
		}

		.form-row {
			flex-direction: column;
			gap: 0;
		}
	}
</style>
