<script lang="ts">
	import { toasts } from '$lib/stores/toast.svelte';

	let { data } = $props();

	let hidingId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let filterHidden = $state<'all' | 'visible' | 'hidden'>('all');
	let searchQuery = $state('');

	const filteredComments = $derived.by(() => {
		let comments = data.comments;
		
		// Filter by hidden status
		if (filterHidden === 'visible') {
			comments = comments.filter(c => !c.isHidden);
		} else if (filterHidden === 'hidden') {
			comments = comments.filter(c => c.isHidden);
		}
		
		// Filter by search query
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			comments = comments.filter(c => 
				c.content.toLowerCase().includes(query) ||
				c.authorName.toLowerCase().includes(query) ||
				c.milestoneTitle.toLowerCase().includes(query) ||
				(c.userEmail && c.userEmail.toLowerCase().includes(query))
			);
		}
		
		return comments;
	});

	async function toggleHide(commentId: string, currentlyHidden: boolean) {
		hidingId = commentId;
		try {
			const res = await fetch(`/api/comments/${commentId}/hide`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ hide: !currentlyHidden })
			});
			if (res.ok) {
				toasts.success(currentlyHidden ? 'Comment unhidden' : 'Comment hidden');
				// Update local state
				const comment = data.comments.find(c => c.id === commentId);
				if (comment) {
					comment.isHidden = !currentlyHidden;
				}
			} else {
				const err = await res.json();
				toasts.error(err.message || 'Failed to update comment');
			}
		} catch {
			toasts.error('Failed to update comment');
		} finally {
			hidingId = null;
		}
	}

	async function deleteComment(commentId: string) {
		if (!confirm('Are you sure you want to permanently delete this comment? This cannot be undone.')) return;
		deletingId = commentId;
		try {
			const res = await fetch(`/api/comments/${commentId}`, { method: 'DELETE' });
			if (res.ok) {
				toasts.success('Comment deleted');
				// Remove from local data
				data.comments = data.comments.filter(c => c.id !== commentId);
			} else {
				const err = await res.json();
				toasts.error(err.message || 'Failed to delete comment');
			}
		} catch {
			toasts.error('Failed to delete comment');
		} finally {
			deletingId = null;
		}
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<div class="comments-admin">
	<div class="header">
		<h1>Comments Moderation</h1>
		<p class="subtitle">Manage and moderate user comments across all entries</p>
	</div>

	<div class="filters">
		<div class="search-box">
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
			<input 
				type="text" 
				placeholder="Search comments..."
				bind:value={searchQuery}
			/>
		</div>
		<div class="filter-tabs">
			<button 
				class:active={filterHidden === 'all'} 
				onclick={() => filterHidden = 'all'}
			>
				All ({data.comments.length})
			</button>
			<button 
				class:active={filterHidden === 'visible'} 
				onclick={() => filterHidden = 'visible'}
			>
				Visible ({data.comments.filter(c => !c.isHidden).length})
			</button>
			<button 
				class:active={filterHidden === 'hidden'} 
				onclick={() => filterHidden = 'hidden'}
			>
				Hidden ({data.comments.filter(c => c.isHidden).length})
			</button>
		</div>
	</div>

	{#if filteredComments.length > 0}
		<!-- Desktop table view -->
		<div class="comments-table desktop-only">
			<table>
				<thead>
					<tr>
						<th>Comment</th>
						<th>Entry</th>
						<th>Author</th>
						<th>Date</th>
						<th>Status</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredComments as comment (comment.id)}
						<tr class:hidden-row={comment.isHidden}>
							<td class="comment-cell">
								<div class="comment-content">
									{comment.content.length > 100 
										? comment.content.slice(0, 100) + '...' 
										: comment.content}
								</div>
								{#if comment.updatedAt}
									<span class="edited-badge">Edited</span>
								{/if}
							</td>
							<td class="entry-cell">
								<a href="/entry/{comment.milestoneId}" target="_blank" class="entry-link">
									<span class="entry-icon">{comment.segmentIcon}</span>
									<span class="entry-title">{comment.milestoneTitle}</span>
								</a>
							</td>
							<td class="author-cell">
								<div class="author-name">{comment.authorName}</div>
								{#if comment.userEmail}
									<div class="author-email">{comment.userEmail}</div>
								{:else}
									<div class="author-anon">Account deleted</div>
								{/if}
							</td>
							<td class="date-cell">
								{formatDate(comment.createdAt)}
							</td>
							<td class="status-cell">
								{#if comment.isHidden}
									<span class="status-badge hidden">Hidden</span>
								{:else}
									<span class="status-badge visible">Visible</span>
								{/if}
							</td>
							<td class="actions-cell">
								<button 
									class="action-btn" 
									class:hide-btn={!comment.isHidden}
									class:show-btn={comment.isHidden}
									onclick={() => toggleHide(comment.id, comment.isHidden)}
									disabled={hidingId === comment.id}
									title={comment.isHidden ? 'Show comment' : 'Hide comment'}
								>
									{#if hidingId === comment.id}
										<span class="spinner"></span>
									{:else if comment.isHidden}
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
									{:else}
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
									{/if}
								</button>
								<button 
									class="action-btn delete-btn" 
									onclick={() => deleteComment(comment.id)}
									disabled={deletingId === comment.id}
									title="Delete comment"
								>
									{#if deletingId === comment.id}
										<span class="spinner"></span>
									{:else}
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
									{/if}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile card view -->
		<div class="comments-cards mobile-only">
			{#each filteredComments as comment (comment.id)}
				<div class="comment-card" class:hidden-row={comment.isHidden}>
					<div class="card-header">
						<div class="card-meta">
							<span class="card-author">{comment.authorName}</span>
							{#if comment.userEmail}
								<span class="card-email">{comment.userEmail}</span>
							{:else}
								<span class="card-email anon">Account deleted</span>
							{/if}
							<span class="card-date">{formatDate(comment.createdAt)}</span>
						</div>
						<div class="card-status">
							{#if comment.isHidden}
								<span class="status-badge hidden">Hidden</span>
							{:else}
								<span class="status-badge visible">Visible</span>
							{/if}
						</div>
					</div>
					
					<div class="card-content">
						{comment.content.length > 150 
							? comment.content.slice(0, 150) + '...' 
							: comment.content}
						{#if comment.updatedAt}
							<span class="edited-badge">Edited</span>
						{/if}
					</div>
					
					<div class="card-entry">
						<a href="/entry/{comment.milestoneId}" target="_blank" class="entry-link">
							<span class="entry-icon">{comment.segmentIcon}</span>
							<span class="entry-title">{comment.milestoneTitle}</span>
						</a>
					</div>
					
					<div class="card-actions">
						<button 
							class="action-btn-mobile" 
							class:show-btn={comment.isHidden}
							onclick={() => toggleHide(comment.id, comment.isHidden)}
							disabled={hidingId === comment.id}
						>
							{#if hidingId === comment.id}
								<span class="spinner"></span>
							{:else if comment.isHidden}
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
								<span>Unhide</span>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
								<span>Hide</span>
							{/if}
						</button>
						<button 
							class="action-btn-mobile delete" 
							onclick={() => deleteComment(comment.id)}
							disabled={deletingId === comment.id}
						>
							{#if deletingId === comment.id}
								<span class="spinner"></span>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
								<span>Delete</span>
							{/if}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
			<p>No comments found</p>
		</div>
	{/if}
</div>

<style>
	.comments-admin {
		padding: 0;
	}

	.header {
		margin-bottom: 2rem;
	}

	.header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 0.5rem 0;
	}

	.subtitle {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: 0;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1.5rem;
		align-items: center;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		flex: 1;
		min-width: 200px;
		max-width: 300px;
	}

	.search-box svg {
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.search-box input {
		border: none;
		background: transparent;
		color: var(--color-text);
		font-size: 0.875rem;
		width: 100%;
		outline: none;
	}

	.search-box input::placeholder {
		color: var(--color-text-muted);
	}

	.filter-tabs {
		display: flex;
		gap: 0.25rem;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		padding: 0.25rem;
	}

	.filter-tabs button {
		padding: 0.5rem 1rem;
		font-size: 0.75rem;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s;
	}

	.filter-tabs button:hover {
		color: var(--color-text);
	}

	.filter-tabs button.active {
		background: var(--color-primary);
		color: white;
	}

	.comments-table {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-lg);
		overflow: hidden;
		border: 1px solid var(--color-border);
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	thead {
		background: var(--color-bg-secondary);
	}

	th {
		text-align: left;
		padding: 0.75rem 1rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	td {
		padding: 1rem;
		border-top: 1px solid var(--color-border);
		vertical-align: top;
	}

	.hidden-row {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 5%, transparent);
	}

	.comment-cell {
		max-width: 300px;
	}

	.comment-content {
		font-size: 0.875rem;
		color: var(--color-text);
		line-height: 1.4;
		word-break: break-word;
	}

	.edited-badge {
		display: inline-block;
		font-size: 0.65rem;
		padding: 0.125rem 0.375rem;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		margin-top: 0.25rem;
	}

	.entry-cell {
		min-width: 150px;
	}

	.entry-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
		color: var(--color-text);
		transition: color 0.15s;
	}

	.entry-link:hover {
		color: var(--color-primary);
	}

	.entry-icon {
		font-size: 1.25rem;
	}

	.entry-title {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.author-cell {
		min-width: 120px;
	}

	.author-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.author-email {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.author-anon {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.date-cell {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.status-cell {
		white-space: nowrap;
	}

	.status-badge {
		display: inline-block;
		font-size: 0.65rem;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		font-weight: 600;
		text-transform: uppercase;
	}

	.status-badge.visible {
		background: color-mix(in srgb, var(--color-success, #22c55e) 15%, transparent);
		color: var(--color-success, #22c55e);
	}

	.status-badge.hidden {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent);
		color: var(--color-warning, #f59e0b);
	}

	.actions-cell {
		white-space: nowrap;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: none;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
		margin-right: 0.25rem;
	}

	.action-btn:hover:not(:disabled) {
		background: var(--color-bg-tertiary, var(--color-border));
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hide-btn:hover:not(:disabled) {
		color: var(--color-warning, #f59e0b);
	}

	.show-btn:hover:not(:disabled) {
		color: var(--color-success, #22c55e);
	}

	.delete-btn:hover:not(:disabled) {
		color: var(--color-danger, #ef4444);
		background: color-mix(in srgb, var(--color-danger, #ef4444) 10%, transparent);
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}

	.empty-state svg {
		margin-bottom: 1rem;
		opacity: 0.5;
	}

	.empty-state p {
		font-size: 0.875rem;
	}

	/* Mobile cards - hidden by default */
	.mobile-only {
		display: none !important;
	}

	.comments-cards {
		flex-direction: column;
		gap: 1rem;
	}

	.comment-card {
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}

	.comment-card.hidden-row {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 5%, var(--color-bg-elevated));
		border-left: 3px solid var(--color-warning, #f59e0b);
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 0.75rem;
	}

	.card-meta {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.card-author {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.card-email {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.card-email.anon {
		font-style: italic;
	}

	.card-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.card-content {
		font-size: 0.875rem;
		color: var(--color-text);
		line-height: 1.5;
		margin-bottom: 0.75rem;
		word-break: break-word;
	}

	.card-entry {
		padding: 0.5rem 0;
		border-top: 1px solid var(--color-border);
		margin-bottom: 0.75rem;
	}

	.card-actions {
		display: flex;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.action-btn-mobile {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.action-btn-mobile:hover:not(:disabled) {
		background: var(--color-bg-secondary);
	}

	.action-btn-mobile:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.action-btn-mobile.show-btn {
		border-color: var(--color-success, #22c55e);
		color: var(--color-success, #22c55e);
	}

	.action-btn-mobile.delete {
		border-color: var(--color-danger, #ef4444);
		color: var(--color-danger, #ef4444);
	}

	.action-btn-mobile.delete:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-danger, #ef4444) 10%, transparent);
	}

	/* Mobile styles */
	@media (max-width: 768px) {
		.header h1 {
			font-size: 1.25rem;
		}

		.filters {
			flex-direction: column;
			align-items: stretch;
		}

		.search-box {
			max-width: none;
		}

		.filter-tabs {
			justify-content: stretch;
		}

		.filter-tabs button {
			flex: 1;
			padding: 0.625rem 0.5rem;
		}

		.desktop-only {
			display: none !important;
		}

		.mobile-only {
			display: flex !important;
		}
	}
</style>
