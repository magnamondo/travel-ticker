<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { toasts } from '$lib/stores/toast.svelte';

	let { data } = $props();

	// Delete state
	let deletingId = $state<string | null>(null);
	let deleteDialogOpen = $state(false);
	let pendingDeleteId = $state<string | null>(null);

	function requestDelete(reactionId: string) {
		pendingDeleteId = reactionId;
		deleteDialogOpen = true;
	}

	function cancelDelete() {
		deleteDialogOpen = false;
		pendingDeleteId = null;
	}

	async function confirmDelete() {
		if (!pendingDeleteId) return;
		deleteDialogOpen = false;
		const reactionId = pendingDeleteId;
		pendingDeleteId = null;
		
		deletingId = reactionId;
		try {
			const res = await fetch(`/api/reactions?id=${encodeURIComponent(reactionId)}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				toasts.success('Reaction deleted');
				await invalidateAll();
			} else {
				const err = await res.json();
				toasts.error(err.message || 'Failed to delete reaction');
			}
		} catch {
			toasts.error('Failed to delete reaction');
		} finally {
			deletingId = null;
		}
	}

	// Build URL with filters
	function buildUrl(params: { page?: number; emoji?: string | null; target?: string | null }) {
		const url = new URL(page.url);
		
		if (params.page !== undefined) {
			if (params.page <= 1) {
				url.searchParams.delete('page');
			} else {
				url.searchParams.set('page', String(params.page));
			}
		}
		
		if (params.emoji !== undefined) {
			if (params.emoji) {
				url.searchParams.set('emoji', params.emoji);
			} else {
				url.searchParams.delete('emoji');
			}
			// Reset to page 1 when changing filters
			url.searchParams.delete('page');
		}
		
		if (params.target !== undefined) {
			if (params.target && params.target !== 'all') {
				url.searchParams.set('target', params.target);
			} else {
				url.searchParams.delete('target');
			}
			// Reset to page 1 when changing filters
			url.searchParams.delete('page');
		}
		
		return url.pathname + url.search;
	}

	function goToPage(p: number) {
		goto(buildUrl({ page: p }));
	}

	function setEmojiFilter(emoji: string | null) {
		goto(buildUrl({ emoji }));
	}

	function setTargetFilter(target: string | null) {
		goto(buildUrl({ target }));
	}

	function clearFilters() {
		goto(resolve('/admin/reactions'));
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

	// Pagination helpers
	const showPagination = $derived(data.pagination.totalPages > 1);
	const pageNumbers = $derived.by(() => {
		const { page: currentPage, totalPages } = data.pagination;
		const pages: (number | 'ellipsis')[] = [];
		
		if (totalPages <= 7) {
			for (let i = 1; i <= totalPages; i++) pages.push(i);
		} else {
			pages.push(1);
			if (currentPage > 3) pages.push('ellipsis');
			for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
				pages.push(i);
			}
			if (currentPage < totalPages - 2) pages.push('ellipsis');
			pages.push(totalPages);
		}
		
		return pages;
	});

	const hasActiveFilters = $derived(data.filters.emoji || data.filters.target);
</script>

<div class="reactions-admin">
	<div class="header">
		<h1>Reactions</h1>
		<p class="subtitle">View all reactions and who posted them ({data.pagination.totalCount} total)</p>
	</div>

	<div class="filters">
		<div class="filter-row">
			<div class="filter-tabs">
				<button 
					class:active={!data.filters.target} 
					onclick={() => setTargetFilter(null)}
				>
					All ({data.targetCounts.all})
				</button>
				<button 
					class:active={data.filters.target === 'milestone'} 
					onclick={() => setTargetFilter('milestone')}
				>
					Entries ({data.targetCounts.milestone})
				</button>
				<button 
					class:active={data.filters.target === 'comment'} 
					onclick={() => setTargetFilter('comment')}
				>
					Comments ({data.targetCounts.comment})
				</button>
			</div>
			{#if hasActiveFilters}
				<button class="clear-filters" onclick={clearFilters}>Clear filters</button>
			{/if}
		</div>
		{#if data.emojiCounts.length > 0}
			<div class="emoji-filters">
				{#each data.emojiCounts as { emoji, count } (emoji)}
					<button 
						class="emoji-filter-btn"
						class:active={data.filters.emoji === emoji}
						onclick={() => setEmojiFilter(data.filters.emoji === emoji ? null : emoji)}
						title="Filter by {emoji}"
					>
						<span class="emoji">{emoji}</span>
						<span class="count">{count}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if data.reactions.length > 0}
		<!-- Desktop table view -->
		<div class="reactions-table desktop-only">
			<table>
				<thead>
					<tr>
						<th>Emoji</th>
						<th>User</th>
						<th>Target</th>
						<th>Entry</th>
						<th>Date</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.reactions as reaction (reaction.id)}
						<tr>
							<td class="emoji-cell">
								<span class="emoji-large">{reaction.emoji}</span>
							</td>
							<td class="user-cell">
								<div class="user-name">{reaction.userName}</div>
								<div class="user-email">{reaction.userEmail}</div>
							</td>
							<td class="target-cell">
								<span class="target-badge {reaction.targetType}">
									{reaction.targetType === 'milestone' ? 'Entry' : 'Comment'}
								</span>
							</td>
							<td class="entry-cell">
								{#if reaction.milestoneId}
									<a href={resolve(`/entry/${reaction.milestoneId}`)} target="_blank" class="entry-link">
										{#if reaction.segmentIcon}
											<span class="entry-icon">{reaction.segmentIcon}</span>
										{/if}
										<span class="entry-title">{reaction.milestoneTitle ?? 'Unknown'}</span>
									</a>
								{:else}
									<span class="no-entry">-</span>
								{/if}
							</td>
							<td class="date-cell">
								{formatDate(reaction.createdAt)}
							</td>
							<td class="actions-cell">
								<button 
									class="delete-btn" 
									title="Delete reaction"
									disabled={deletingId === reaction.id}
									onclick={() => requestDelete(reaction.id)}
								>
									{#if deletingId === reaction.id}
										...
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
		<div class="reactions-cards mobile-only">
			{#each data.reactions as reaction (reaction.id)}
				<div class="reaction-card">
					<div class="card-header">
						<span class="emoji-large">{reaction.emoji}</span>
						<div class="card-meta">
							<span class="target-badge {reaction.targetType}">
								{reaction.targetType === 'milestone' ? 'Entry' : 'Comment'}
							</span>
							<span class="card-date">{formatDate(reaction.createdAt)}</span>
						</div>
					</div>
					<div class="card-user">
						<div class="user-name">{reaction.userName}</div>
						<div class="user-email">{reaction.userEmail}</div>
					</div>
					<div class="card-footer">
						{#if reaction.milestoneId}
							<a href={resolve(`/entry/${reaction.milestoneId}`)} target="_blank" class="card-entry">
								{#if reaction.segmentIcon}
									<span class="entry-icon">{reaction.segmentIcon}</span>
								{/if}
								<span class="entry-title">{reaction.milestoneTitle ?? 'Unknown'}</span>
							</a>
						{/if}
						<button 
							class="delete-btn" 
							title="Delete reaction"
							disabled={deletingId === reaction.id}
							onclick={() => requestDelete(reaction.id)}
						>
							{#if deletingId === reaction.id}
								...
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
							{/if}
						</button>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		{#if showPagination}
			<nav class="pagination">
				<button 
					class="page-btn" 
					disabled={data.pagination.page <= 1}
					onclick={() => goToPage(data.pagination.page - 1)}
				>
					&larr; Prev
				</button>
				
				<div class="page-numbers">
					{#each pageNumbers as p (p)}
						{#if p === 'ellipsis'}
							<span class="ellipsis">...</span>
						{:else}
							<button 
								class="page-num" 
								class:active={p === data.pagination.page}
								onclick={() => goToPage(p)}
							>
								{p}
							</button>
						{/if}
					{/each}
				</div>
				
				<button 
					class="page-btn" 
					disabled={data.pagination.page >= data.pagination.totalPages}
					onclick={() => goToPage(data.pagination.page + 1)}
				>
					Next &rarr;
				</button>
			</nav>
		{/if}
	{:else}
		<div class="empty-state">
			<p>No reactions found{hasActiveFilters ? ' matching your filters' : ''}.</p>
		</div>
	{/if}
</div>

<ConfirmDialog
	open={deleteDialogOpen}
	title="Delete Reaction"
	message="Are you sure you want to delete this reaction? This cannot be undone."
	confirmText="Delete"
	cancelText="Cancel"
	onconfirm={confirmDelete}
	oncancel={cancelDelete}
/>

<style>
	.reactions-admin {
		padding: 2rem;
		max-width: 1200px;
		margin: 0 auto;
	}

	.header {
		margin-bottom: 2rem;
	}

	.header h1 {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text);
		margin: 0 0 0.5rem 0;
	}

	.subtitle {
		color: var(--color-text-muted);
		margin: 0;
	}

	.filters {
		margin-bottom: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.filter-row {
		display: flex;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.filter-tabs {
		display: flex;
		gap: 0.25rem;
		background: var(--color-bg-secondary);
		padding: 0.25rem;
		border-radius: var(--radius-md);
	}

	.filter-tabs button {
		padding: 0.375rem 0.75rem;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.filter-tabs button:hover {
		color: var(--color-text);
	}

	.filter-tabs button.active {
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: var(--shadow-sm);
	}

	.clear-filters {
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--color-border);
		background: transparent;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.clear-filters:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.emoji-filters {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.emoji-filter-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all 0.15s;
	}

	.emoji-filter-btn:hover {
		border-color: var(--color-primary);
	}

	.emoji-filter-btn.active {
		border-color: var(--color-primary);
		background: var(--color-primary-light);
	}

	.emoji-filter-btn .emoji {
		font-size: 1rem;
	}

	.emoji-filter-btn .count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Desktop table */
	.reactions-table {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.reactions-table table {
		width: 100%;
		border-collapse: collapse;
	}

	.reactions-table th {
		text-align: left;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border);
	}

	.reactions-table td {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		vertical-align: middle;
	}

	.reactions-table tr:last-child td {
		border-bottom: none;
	}

	.emoji-cell {
		width: 60px;
	}

	.emoji-large {
		font-size: 1.5rem;
	}

	.user-cell {
		min-width: 180px;
	}

	.user-name {
		font-weight: 500;
		color: var(--color-text);
	}

	.user-email {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.target-cell {
		width: 100px;
	}

	.target-badge {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.target-badge.milestone {
		background: var(--color-primary-light);
		color: var(--color-primary);
	}

	.target-badge.comment {
		background: rgba(139, 92, 246, 0.1);
		color: rgb(139, 92, 246);
	}

	.entry-cell {
		min-width: 200px;
	}

	.entry-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
		text-decoration: none;
	}

	.entry-link:hover .entry-title {
		color: var(--color-primary);
	}

	.entry-icon {
		font-size: 1.125rem;
	}

	.entry-title {
		font-size: 0.875rem;
		transition: color 0.15s;
	}

	.no-entry {
		color: var(--color-text-muted);
	}

	.date-cell {
		white-space: nowrap;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.actions-cell {
		width: 60px;
		text-align: center;
	}

	.delete-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--color-border);
		background: transparent;
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.delete-btn:hover:not(:disabled) {
		border-color: #ef4444;
		color: #ef4444;
		background: rgba(239, 68, 68, 0.1);
	}

	.delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Mobile cards */
	.reactions-cards {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.reaction-card {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.card-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.card-user {
		margin-bottom: 0.75rem;
	}

	.card-entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-md);
		color: var(--color-text);
		text-decoration: none;
		font-size: 0.875rem;
		flex: 1;
	}

	.card-entry:hover {
		background: var(--color-border);
	}

	.card-footer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Responsive */
	.desktop-only {
		display: block;
	}

	.mobile-only {
		display: none;
	}

	@media (max-width: 768px) {
		.reactions-admin {
			padding: 1rem;
		}

		.desktop-only {
			display: none;
		}

		.mobile-only {
			display: flex;
		}

		.filter-tabs {
			width: 100%;
			overflow-x: auto;
		}
	}

	.empty-state {
		text-align: center;
		padding: 3rem;
		color: var(--color-text-muted);
	}

	/* Pagination */
	.pagination {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.5rem;
		padding: 1rem 0;
	}

	.page-btn {
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.page-btn:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.page-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.page-numbers {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.page-num {
		min-width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.page-num:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.page-num.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}

	.ellipsis {
		padding: 0 0.5rem;
		color: var(--color-text-muted);
	}

	@media (max-width: 768px) {
		.pagination {
			flex-wrap: wrap;
		}

		.page-numbers {
			order: -1;
			width: 100%;
			justify-content: center;
			margin-bottom: 0.5rem;
		}
	}
</style>
