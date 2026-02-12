<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { resolve } from '$app/paths';

	let { data, form } = $props();

	let lastToastMessage = $state<string | null>(null);
	let openMenuId = $state<string | null>(null);
	let confirmDeleteAll = $state(false);
	let confirmDeleteChunks = $state(false);

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

	function toggleMenu(id: string, event: MouseEvent) {
		event.stopPropagation();
		openMenuId = openMenuId === id ? null : id;
	}

	function closeMenu() {
		openMenuId = null;
	}

	function formatDate(date: Date | null) {
		if (!date) return '—';
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(date);
	}

	function formatDuration(seconds: number | null | undefined) {
		if (seconds === null || seconds === undefined) return '';
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `0:${secs.toString().padStart(2, '0')}`;
	}

	function getFilterUrl(filter: string, page = 1) {
		const params = new URLSearchParams();
		if (filter !== 'all') params.set('filter', filter);
		if (page > 1) params.set('page', String(page));
		const queryString = params.toString();
		return queryString ? `?${queryString}` : '?';
	}

	function getPaginationUrl(page: number) {
		const params = new URLSearchParams();
		if (data.filter !== 'all') params.set('filter', data.filter);
		if (page > 1) params.set('page', String(page));
		const queryString = params.toString();
		return queryString ? `?${queryString}` : '?';
	}

	function getFilename(url: string | null): string {
		if (!url) return '';
		return url.split('/').pop() || url;
	}

	const isOrphanView = $derived(data.filter === 'orphans');
</script>

<div class="media-page">
	<div class="page-header">
		<h1>Media Library</h1>
		<p class="subtitle">Manage uploaded images and videos</p>
	</div>

	<!-- Stats Cards -->
	<div class="stats-grid">
		<div class="stat-card">
			<span class="stat-value">{data.stats.totalFiles}</span>
			<span class="stat-label">Total Files</span>
			<span class="stat-detail">{data.stats.totalSize}</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.stats.images}</span>
			<span class="stat-label">Images</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.stats.videos}</span>
			<span class="stat-label">Videos</span>
		</div>
		<div class="stat-card" class:warning={data.stats.orphans > 0}>
			<span class="stat-value">{data.stats.orphans}</span>
			<span class="stat-label">Orphaned</span>
			{#if data.stats.orphans > 0}
				<span class="stat-detail">{data.stats.orphanedSize}</span>
			{/if}
		</div>
		{#if data.stats.chunksSizeBytes > 0}
			<div class="stat-card warning">
				<span class="stat-value">{data.stats.chunksSize}</span>
				<span class="stat-label">Pending Chunks</span>
				{#if confirmDeleteChunks}
					<div class="stat-action">
						<form method="POST" action="?/deleteAllChunks" use:enhance={() => {
							return async ({ update }) => {
								confirmDeleteChunks = false;
								await update();
							};
						}}>
							<button type="submit" class="btn-small danger">Confirm</button>
						</form>
						<button class="btn-small" onclick={() => (confirmDeleteChunks = false)}>Cancel</button>
					</div>
				{:else}
					<button class="btn-small" onclick={() => (confirmDeleteChunks = true)}>Clear</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Filter Tabs -->
	<div class="filter-tabs">
		<a href={getFilterUrl('all')} class="filter-tab" class:active={data.filter === 'all'}>
			All
		</a>
		<a href={getFilterUrl('images')} class="filter-tab" class:active={data.filter === 'images'}>
			Images ({data.stats.images})
		</a>
		<a href={getFilterUrl('videos')} class="filter-tab" class:active={data.filter === 'videos'}>
			Videos ({data.stats.videos})
		</a>
		<a href={getFilterUrl('orphans')} class="filter-tab" class:active={data.filter === 'orphans'} class:warning={data.stats.orphans > 0}>
			Orphaned ({data.stats.orphans})
		</a>
	</div>

	<!-- Bulk Actions for Orphans -->
	{#if isOrphanView && data.stats.orphans > 0}
		<div class="bulk-actions">
			{#if confirmDeleteAll}
				<div class="confirm-delete">
					<span>Delete all {data.stats.orphans} orphaned files ({data.stats.orphanedSize})?</span>
					<form method="POST" action="?/deleteAllOrphans" use:enhance={() => {
						return async ({ update }) => {
							confirmDeleteAll = false;
							await update();
						};
					}}>
						<button type="submit" class="btn-danger">Yes, Delete All</button>
					</form>
					<button class="btn-secondary" onclick={() => (confirmDeleteAll = false)}>Cancel</button>
				</div>
			{:else}
				<button class="btn-danger" onclick={() => (confirmDeleteAll = true)}>
					Delete All Orphaned Files
				</button>
			{/if}
		</div>
	{/if}

	<!-- Content -->
	{#if isOrphanView}
		<!-- Orphaned Files List -->
		{#if data.orphans.length === 0}
			<div class="empty-state">
				<span class="empty-icon">✅</span>
				<p>No orphaned files</p>
				<p class="empty-hint">All files on disk are properly linked to entries</p>
			</div>
		{:else}
			<div class="orphans-list">
				{#each data.orphans as orphan (orphan.filename)}
					<div class="orphan-item">
						<div class="orphan-preview">
							{#if orphan.filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)}
								<img src="/api/uploads/{orphan.filename}" alt="" loading="lazy" />
							{:else if orphan.filename.match(/\.(mp4|webm|mov)$/i)}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video src="/api/uploads/{orphan.filename}" preload="metadata"></video>
								<span class="video-badge">Video</span>
							{:else}
								<div class="file-icon">📄</div>
							{/if}
						</div>
						<div class="orphan-info">
							<span class="orphan-filename" title={orphan.filename}>{orphan.filename}</span>
							<div class="orphan-meta">
								<span>{orphan.sizeFormatted}</span>
								<span>{formatDate(orphan.modifiedAt)}</span>
							</div>
						</div>
						<div class="orphan-actions">
							<a href="/api/uploads/{orphan.filename}" target="_blank" class="btn-icon" title="View file">
								<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/><path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
							</a>
							<form method="POST" action="?/deleteOrphan" use:enhance>
								<input type="hidden" name="filename" value={orphan.filename} />
								<button 
									type="submit" 
									class="btn-icon danger" 
									title="Delete file"
									onclick={(e) => { if (!confirm(`Delete ${orphan.filename}?`)) e.preventDefault(); }}
								>
									<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>
								</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<!-- Media Grid -->
		{#if data.media.length === 0}
			<div class="empty-state">
				<span class="empty-icon">🖼️</span>
				<p>No media found</p>
				<p class="empty-hint">Upload media by adding entries with images or videos</p>
			</div>
		{:else}
			<div class="media-grid">
				{#each data.media as media (media.id)}
					<div class="media-card">
						<div class="media-preview">
							{#if media.type === 'image'}
								<img src={media.url} alt={media.caption || ''} loading="lazy" />
							{:else}
								{#if media.thumbnailUrl}
									<img src={media.thumbnailUrl} alt="" loading="lazy" />
								{:else}
									<div class="video-placeholder">🎬</div>
								{/if}
								<span class="video-badge">
									{#if media.duration}
										{formatDuration(media.duration)}
									{:else}
										Video
									{/if}
								</span>
							{/if}
						</div>
						<div class="media-info">
							<span class="media-entry" title={media.milestoneTitle || ''}>
								{#if media.milestoneTitle}
									<a href={resolve(`/entry/${media.milestoneId}`)}>{media.milestoneTitle}</a>
								{:else}
									<span class="orphaned-label">No entry</span>
								{/if}
							</span>
							{#if media.caption}
								<span class="media-caption">{media.caption}</span>
							{/if}
							<span class="media-date">{formatDate(media.createdAt)}</span>
						</div>
						<div class="media-actions">
							<div class="dropdown">
								<button 
									class="btn-menu" 
									onclick={(e) => toggleMenu(media.id, e)}
									aria-label="More actions"
								>
									<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><circle cx="4" cy="10" r="2"/><circle cx="10" cy="10" r="2"/><circle cx="16" cy="10" r="2"/></svg>
								</button>
								{#if openMenuId === media.id}
									<button class="dropdown-backdrop" onclick={closeMenu} aria-label="Close menu"></button>
									<div class="dropdown-menu">
										<a href={media.url} target="_blank" class="dropdown-item" onclick={closeMenu}>
											<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/><path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
											View full size
										</a>
										{#if media.milestoneId}
											<a href="/admin/entries#{media.milestoneId}" class="dropdown-item" onclick={closeMenu}>
												<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z"/><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z"/></svg>
												Edit entry
											</a>
										{/if}
										<div class="dropdown-divider"></div>
										<form method="POST" action="?/deleteMedia" use:enhance={() => {
											return async ({ update }) => {
												closeMenu();
												await update();
											};
										}}>
											<input type="hidden" name="mediaId" value={media.id} />
											<button 
												type="submit" 
												class="dropdown-item danger"
												onclick={(e) => { if (!confirm('Delete this media? This cannot be undone.')) e.preventDefault(); }}
											>
												<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>
												Delete media
											</button>
										</form>
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- Pagination -->
	{#if data.pagination.totalPages > 1}
		<div class="pagination">
			<span class="pagination-info">
				Showing {(data.pagination.page - 1) * data.pagination.pageSize + 1}–{Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.total)} of {data.pagination.total}
			</span>
			<div class="pagination-controls">
				{#if data.pagination.page > 1}
					<a href={getPaginationUrl(data.pagination.page - 1)} class="pagination-btn">← Prev</a>
				{:else}
					<span class="pagination-btn disabled">← Prev</span>
				{/if}

				<span class="pagination-pages">
					{#each Array.from({ length: data.pagination.totalPages }, (_, i) => i + 1) as pageNum (pageNum)}
						{#if pageNum === 1 || pageNum === data.pagination.totalPages || (pageNum >= data.pagination.page - 2 && pageNum <= data.pagination.page + 2)}
							{#if pageNum === data.pagination.page}
								<span class="pagination-btn current">{pageNum}</span>
							{:else}
								<a href={getPaginationUrl(pageNum)} class="pagination-btn">{pageNum}</a>
							{/if}
						{:else if pageNum === 2 || pageNum === data.pagination.totalPages - 1}
							<span class="pagination-ellipsis">…</span>
						{/if}
					{/each}
				</span>

				{#if data.pagination.page < data.pagination.totalPages}
					<a href={getPaginationUrl(data.pagination.page + 1)} class="pagination-btn">Next →</a>
				{:else}
					<span class="pagination-btn disabled">Next →</span>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.media-page {
		max-width: 1400px;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.subtitle {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	/* Stats Grid */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.stat-card {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stat-card.warning {
		border: 1px solid var(--color-warning);
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.stat-detail {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Filter Tabs */
	.filter-tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-border);
		padding-bottom: 0.5rem;
	}

	.filter-tab {
		padding: 0.5rem 1rem;
		border-radius: var(--radius-md);
		text-decoration: none;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		font-weight: 500;
		transition: all 0.15s;
	}

	.filter-tab:hover {
		color: var(--color-text);
		background: var(--color-bg-elevated);
	}

	.filter-tab.active {
		color: var(--color-primary);
		background: var(--color-primary-bg);
	}

	.filter-tab.warning {
		color: var(--color-warning);
	}

	/* Bulk Actions */
	.bulk-actions {
		margin-bottom: 1.5rem;
		padding: 1rem;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
	}

	.confirm-delete {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.confirm-delete span {
		font-weight: 500;
	}

	/* Media Grid */
	.media-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1rem;
	}

	.media-card {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
	}

	.media-preview {
		position: relative;
		aspect-ratio: 1;
		background: var(--color-bg-secondary);
		overflow: hidden;
		border-radius: var(--radius-md) var(--radius-md) 0 0;
	}

	.media-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.video-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 3rem;
	}

	.video-badge {
		position: absolute;
		bottom: 0.5rem;
		right: 0.5rem;
		background: rgba(0, 0, 0, 0.75);
		color: white;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.media-info {
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
	}

	.media-entry {
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.media-entry a {
		color: var(--color-text);
		text-decoration: none;
	}

	.media-entry a:hover {
		color: var(--color-primary);
	}

	.orphaned-label {
		color: var(--color-warning);
	}

	.media-caption {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.media-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.media-actions {
		padding: 0 0.75rem 0.75rem;
	}

	/* Orphans List */
	.orphans-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.orphan-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
	}

	.orphan-preview {
		width: 64px;
		height: 64px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--color-bg-secondary);
		flex-shrink: 0;
		position: relative;
	}

	.orphan-preview img,
	.orphan-preview video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.file-icon {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
	}

	.orphan-info {
		flex: 1;
		min-width: 0;
	}

	.orphan-filename {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.orphan-meta {
		display: flex;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.orphan-actions {
		display: flex;
		gap: 0.5rem;
	}

	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
	}

	.empty-icon {
		font-size: 3rem;
		display: block;
		margin-bottom: 1rem;
	}

	.empty-state p {
		color: var(--color-text);
		font-weight: 500;
		margin: 0;
	}

	.empty-hint {
		color: var(--color-text-muted) !important;
		font-weight: 400 !important;
		margin-top: 0.5rem !important;
	}

	/* Buttons */
	.btn-secondary {
		padding: 0.5rem 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text);
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-secondary:hover {
		background: var(--color-bg-elevated);
	}

	.btn-danger {
		padding: 0.5rem 1rem;
		background: var(--color-danger);
		border: none;
		border-radius: var(--radius-md);
		color: white;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-danger:hover {
		opacity: 0.9;
	}

	.btn-icon {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
		text-decoration: none;
	}

	.btn-icon:hover {
		color: var(--color-text);
		background: var(--color-bg-elevated);
	}

	.btn-icon.danger:hover {
		color: var(--color-danger);
	}

	.btn-menu {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-menu:hover {
		color: var(--color-text);
		background: var(--color-bg-secondary);
	}

	.btn-menu svg {
		width: 16px;
		height: 16px;
	}

	/* Dropdown */
	.dropdown {
		position: relative;
	}

	.dropdown-backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		z-index: 10;
		border: none;
		cursor: default;
	}

	.dropdown-menu {
		position: absolute;
		top: 100%;
		right: 0;
		min-width: 180px;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		z-index: 20;
		padding: 0.25rem 0;
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 0.875rem;
		text-decoration: none;
		cursor: pointer;
		text-align: left;
	}

	.dropdown-item:hover {
		background: var(--color-bg-secondary);
	}

	.dropdown-item.danger {
		color: var(--color-danger);
	}

	.dropdown-item svg {
		flex-shrink: 0;
	}

	.dropdown-divider {
		height: 1px;
		background: var(--color-border);
		margin: 0.25rem 0;
	}

	/* Pagination */
	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
		flex-wrap: wrap;
		gap: 1rem;
	}

	.pagination-info {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.pagination-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.pagination-pages {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.pagination-btn {
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: 0.875rem;
		text-decoration: none;
		cursor: pointer;
	}

	.pagination-btn:hover:not(.disabled):not(.current) {
		background: var(--color-bg-secondary);
	}

	.pagination-btn.current {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}

	.pagination-btn.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.pagination-ellipsis {
		padding: 0 0.25rem;
		color: var(--color-text-muted);
	}

	/* Responsive */
	@media (max-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.filter-tabs {
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
		}

		.media-grid {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		}

		.pagination {
			flex-direction: column;
			align-items: stretch;
		}

		.pagination-info {
			text-align: center;
		}

		.pagination-controls {
			justify-content: center;
		}
	}

	/* Small inline buttons for stat cards */
	.stat-action {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.btn-small {
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-small:hover {
		background: var(--color-bg-elevated);
		color: var(--color-text);
	}

	.btn-small.danger {
		background: var(--color-danger);
		border-color: var(--color-danger);
		color: white;
	}

	.btn-small.danger:hover {
		opacity: 0.9;
	}
</style>
