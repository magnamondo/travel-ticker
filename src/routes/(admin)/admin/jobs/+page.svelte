<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	let { data, form } = $props();

	// Track last shown toast to avoid duplicates
	let lastToastMessage = $state<string | null>(null);
	let openMenuId = $state<string | null>(null);

	// ConfirmDialog state
	let deleteAllDialogOpen = $state(false);
	let deleteJobDialogOpen = $state(false);
	let pendingDeleteJobId = $state<string | null>(null);

	function toggleMenu(jobId: string, event: MouseEvent) {
		event.stopPropagation();
		openMenuId = openMenuId === jobId ? null : jobId;
	}

	function closeMenu() {
		openMenuId = null;
	}

	// ConfirmDialog handlers
	function confirmDeleteAllJobs() {
		deleteAllDialogOpen = false;
		const form = document.getElementById('delete-all-jobs-form') as HTMLFormElement;
		form?.requestSubmit();
	}

	function cancelDeleteAll() {
		deleteAllDialogOpen = false;
	}

	function requestDeleteJob(jobId: string) {
		pendingDeleteJobId = jobId;
		deleteJobDialogOpen = true;
	}

	function confirmDeleteJob() {
		if (!pendingDeleteJobId) return;
		const form = document.getElementById(`delete-job-${pendingDeleteJobId}`) as HTMLFormElement;
		deleteJobDialogOpen = false;
		closeMenu();
		const jobId = pendingDeleteJobId;
		pendingDeleteJobId = null;
		form?.requestSubmit();
	}

	function cancelDeleteJob() {
		deleteJobDialogOpen = false;
		pendingDeleteJobId = null;
	}

	// Show toast when form result changes
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
		if (seconds === null || seconds === undefined) return '—';
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
	}

	function getProcessingTime(job: typeof data.jobs[0]): string {
		if (!job.startedAt) return '—';
		const end = job.completedAt || new Date();
		const seconds = Math.round((end.getTime() - job.startedAt.getTime()) / 1000);
		return formatDuration(seconds);
	}

	function getStatusClass(status: string) {
		switch (status) {
			case 'completed': return 'status-completed';
			case 'failed': return 'status-failed';
			case 'processing': return 'status-processing';
			default: return 'status-pending';
		}
	}

	function getStatusIcon(status: string) {
		switch (status) {
			case 'completed': return '✅';
			case 'failed': return '❌';
			case 'processing': return '⏳';
			default: return '🕐';
		}
	}
</script>

<div class="jobs-page">
	<div class="page-header">
		<h1>Video Processing Jobs</h1>
		<p class="subtitle">Monitor and manage video transcoding queue</p>
	</div>

	<!-- Stats Cards -->
	<div class="stats-grid">
		<div class="stat-card">
			<span class="stat-value">{data.stats.total}</span>
			<span class="stat-label">Total Jobs</span>
		</div>
		<div class="stat-card pending">
			<span class="stat-value">{data.stats.pending}</span>
			<span class="stat-label">Pending</span>
		</div>
		<div class="stat-card processing">
			<span class="stat-value">{data.stats.processing}</span>
			<span class="stat-label">Processing</span>
		</div>
		<div class="stat-card completed">
			<span class="stat-value">{data.stats.completed}</span>
			<span class="stat-label">Completed</span>
		</div>
		<div class="stat-card failed">
			<span class="stat-value">{data.stats.failed}</span>
			<span class="stat-label">Failed</span>
		</div>
	</div>

	<!-- Bulk Actions -->
	<div class="bulk-actions">
		<form method="POST" action="?/deleteAll" use:enhance>
			<input type="hidden" name="status" value="completed" />
			<button type="submit" class="btn-secondary" disabled={data.stats.completed === 0}>
				🗑️ Clear Completed ({data.stats.completed})
			</button>
		</form>
		<form method="POST" action="?/deleteAll" use:enhance>
			<input type="hidden" name="status" value="failed" />
			<button type="submit" class="btn-secondary" disabled={data.stats.failed === 0}>
				🗑️ Clear Failed ({data.stats.failed})
			</button>
		</form>
		<form id="delete-all-jobs-form" method="POST" action="?/deleteAll" use:enhance>
			<input type="hidden" name="status" value="all" />
			<button type="button" class="btn-danger" disabled={data.stats.total === 0} onclick={() => (deleteAllDialogOpen = true)}>
				🗑️ Clear All
			</button>
		</form>
	</div>

	<!-- Jobs Table -->
	{#if data.jobs.length === 0}
		<div class="empty-state">
			<span class="empty-icon">🎬</span>
			<p>No video processing jobs</p>
			<p class="empty-hint">Jobs appear here when videos are uploaded</p>
		</div>
	{:else}
		<div class="jobs-table-wrapper">
			<table class="jobs-table">
				<thead>
					<tr>
						<th>Status</th>
						<th>Filename</th>
						<th>Progress</th>
						<th>Length</th>
						<th>Proc. Time</th>
						<th>Created</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.jobs as job (job.id)}
						<tr class="{getStatusClass(job.status)}" class:menu-open={openMenuId === job.id}>
							<td class="status-cell">
								<span class="status-badge {job.status}">
									{getStatusIcon(job.status)} {job.status}
								</span>
							</td>
							<td class="filename-cell">
								<span class="filename" title={job.filename}>{job.filename}</span>
								{#if job.error}
									<span class="error-text" title={job.error}>⚠️ {job.error}</span>
								{/if}
							</td>
							<td class="progress-cell">
								{#if job.status === 'processing'}
									<div class="progress-bar">
										<div class="progress-fill" style="width: {job.progress}%"></div>
									</div>
									<span class="progress-text">{job.progress}%</span>
								{:else if job.status === 'completed'}
									<span class="progress-text">100%</span>
								{:else}
									<span class="progress-text">—</span>
								{/if}
							</td>
							<td class="length-cell">{formatDuration(job.duration)}</td>
							<td class="proctime-cell">{getProcessingTime(job)}</td>
							<td class="date-cell">{formatDate(job.createdAt)}</td>
							<td class="actions-cell">
								<div class="actions-wrapper">
									<div class="dropdown">
										<button 
											class="btn-menu" 
											onclick={(e) => toggleMenu(job.id, e)}
											aria-label="More actions"
										>
											<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="2"/><circle cx="10" cy="10" r="2"/><circle cx="16" cy="10" r="2"/></svg>
										</button>
										{#if openMenuId === job.id}
											<button class="dropdown-backdrop" onclick={closeMenu} aria-label="Close menu"></button>
											<div class="dropdown-menu">
												<div class="dropdown-header">{job.filename}</div>
												{#if job.status === 'failed'}
													<form method="POST" action="?/retry" use:enhance={() => {
														return async ({ update }) => {
															closeMenu();
															await update();
														};
													}}>
														<input type="hidden" name="jobId" value={job.id} />
														<button type="submit" class="dropdown-item">
															<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.39 2.64A5.5 5.5 0 019.5 4.5v1a4.5 4.5 0 100 9 4.5 4.5 0 004.062-2.576.75.75 0 011.25.152z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M9.5 2.25a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M12.5 5.75a.75.75 0 000-1.5h-3a.75.75 0 000 1.5h3z" clip-rule="evenodd"/></svg>
															Retry job
														</button>
													</form>
												{/if}
												{#if job.resultUrl}
													<a href={job.resultUrl} target="_blank" class="dropdown-item" onclick={closeMenu}>
														<svg viewBox="0 0 20 20" fill="currentColor"><path d="M3.25 4A2.25 2.25 0 001 6.25v7.5A2.25 2.25 0 003.25 16h7.5A2.25 2.25 0 0013 13.75v-7.5A2.25 2.25 0 0010.75 4h-7.5zM19 4.75a.75.75 0 00-1.28-.53l-3 3a.75.75 0 00-.22.53v4.5c0 .199.079.39.22.53l3 3a.75.75 0 001.28-.53V4.75z"/></svg>
														View video
													</a>
												{/if}
												{#if job.thumbnailUrl}
													<a href={job.thumbnailUrl} target="_blank" class="dropdown-item" onclick={closeMenu}>
														<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.909a.75.75 0 01-1.06 0l-3.94-3.94a.75.75 0 00-1.06 0L2.5 11.06zm8-3.06a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" clip-rule="evenodd"/></svg>
														View thumbnail
													</a>
												{/if}
												<div class="dropdown-divider"></div>
												<form id="delete-job-{job.id}" method="POST" action="?/delete" use:enhance={() => {
													return async ({ update }) => {
														closeMenu();
														await update();
													};
												}}>
													<input type="hidden" name="jobId" value={job.id} />
													<button 
														type="button" 
														class="dropdown-item danger"
														onclick={() => requestDeleteJob(job.id)}
													>
														<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>
														Delete job
													</button>
												</form>
											</div>
										{/if}
									</div>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		{#if data.pagination.totalPages > 1}
			<div class="pagination">
				<span class="pagination-info">
					Showing {(data.pagination.page - 1) * data.pagination.pageSize + 1}–{Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.total)} of {data.pagination.total}
				</span>
				<div class="pagination-controls">
					{#if data.pagination.page > 1}
						<a href="?page={data.pagination.page - 1}" class="pagination-btn">← Prev</a>
					{:else}
						<span class="pagination-btn disabled">← Prev</span>
					{/if}

					<span class="pagination-pages">
						{#each Array.from({ length: data.pagination.totalPages }, (_, i) => i + 1) as pageNum (pageNum)}
							{#if pageNum === 1 || pageNum === data.pagination.totalPages || (pageNum >= data.pagination.page - 2 && pageNum <= data.pagination.page + 2)}
								{#if pageNum === data.pagination.page}
									<span class="pagination-btn current">{pageNum}</span>
								{:else}
									<a href="?page={pageNum}" class="pagination-btn">{pageNum}</a>
								{/if}
							{:else if pageNum === 2 || pageNum === data.pagination.totalPages - 1}
								<span class="pagination-ellipsis">…</span>
							{/if}
						{/each}
					</span>

					{#if data.pagination.page < data.pagination.totalPages}
						<a href="?page={data.pagination.page + 1}" class="pagination-btn">Next →</a>
					{:else}
						<span class="pagination-btn disabled">Next →</span>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>

<ConfirmDialog
	open={deleteAllDialogOpen}
	title="Delete All Jobs"
	message="Delete ALL jobs? This cannot be undone."
	confirmText="Delete All"
	variant="danger"
	onconfirm={confirmDeleteAllJobs}
	oncancel={cancelDeleteAll}
/>

<ConfirmDialog
	open={deleteJobDialogOpen}
	title="Delete Job"
	message="Delete this job?"
	confirmText="Delete"
	variant="danger"
	onconfirm={confirmDeleteJob}
	oncancel={cancelDeleteJob}
/>

<style>
	.jobs-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem;
	}

	.page-header {
		margin-bottom: 1.5rem;
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
		text-align: center;
	}

	.stat-card.pending { border-left: 3px solid #f59e0b; }
	.stat-card.processing { border-left: 3px solid #3b82f6; }
	.stat-card.completed { border-left: 3px solid #10b981; }
	.stat-card.failed { border-left: 3px solid #ef4444; }

	.stat-value {
		display: block;
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}

	.bulk-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.btn-secondary {
		padding: 0.5rem 1rem;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--color-bg-secondary);
	}

	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-danger {
		padding: 0.5rem 1rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: var(--radius-md);
		color: #ef4444;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.btn-danger:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.2);
	}

	.btn-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.empty-state {
		text-align: center;
		padding: 3rem;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
	}

	.empty-icon {
		font-size: 3rem;
		display: block;
		margin-bottom: 1rem;
	}

	.empty-state p {
		color: var(--color-text-muted);
		margin: 0;
	}

	.empty-hint {
		font-size: 0.875rem;
		margin-top: 0.5rem !important;
	}

	.jobs-table-wrapper {
		overflow-x: auto;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
	}

	.jobs-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.jobs-table th {
		text-align: left;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		font-weight: 500;
		font-size: 0.75rem;
		text-transform: uppercase;
		border-bottom: 1px solid var(--color-border);
	}

	.jobs-table td {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		vertical-align: middle;
	}

	.jobs-table tbody tr:last-child td {
		border-bottom: none;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.status-badge.pending {
		background: rgba(245, 158, 11, 0.1);
		color: #f59e0b;
	}

	.status-badge.processing {
		background: rgba(59, 130, 246, 0.1);
		color: #3b82f6;
	}

	.status-badge.completed {
		background: rgba(16, 185, 129, 0.1);
		color: #10b981;
	}

	.status-badge.failed {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	.filename-cell {
		max-width: 250px;
	}

	.filename {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.error-text {
		display: block;
		font-size: 0.75rem;
		color: #ef4444;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 200px;
	}

	.progress-cell {
		min-width: 100px;
	}

	.progress-bar {
		width: 60px;
		height: 6px;
		background: var(--color-bg-secondary);
		border-radius: 3px;
		overflow: hidden;
		display: inline-block;
		vertical-align: middle;
		margin-right: 0.5rem;
	}

	.progress-fill {
		height: 100%;
		background: #3b82f6;
		transition: width 0.3s;
	}

	.progress-text {
		color: var(--color-text-muted);
	}

	.date-cell {
		white-space: nowrap;
		color: var(--color-text-muted);
	}

	.length-cell,
	.proctime-cell {
		color: var(--color-text-muted);
	}

	.actions-cell {
		width: 80px;
	}

	.actions-wrapper {
		display: flex;
		align-items: center;
		justify-content: flex-end;
	}

	.dropdown {
		position: relative;
	}

	.btn-menu {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.btn-menu:hover {
		background: var(--color-bg-hover);
		border-color: var(--color-border);
		color: var(--color-text);
	}

	.btn-menu svg {
		width: 16px;
		height: 16px;
	}

	.dropdown-backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		border: none;
		cursor: default;
		z-index: 99;
	}

	.dropdown-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 0.25rem;
		min-width: 180px;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
		z-index: 100;
		overflow: hidden;
	}

	.dropdown-menu form {
		display: contents;
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.625rem 0.875rem;
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: 0.8125rem;
		color: var(--color-text);
		text-align: left;
		text-decoration: none;
		transition: background 0.1s;
	}

	.dropdown-item:hover {
		background: var(--color-bg-hover);
	}

	.dropdown-item svg {
		width: 16px;
		height: 16px;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.dropdown-item.danger {
		color: var(--color-danger);
	}

	.dropdown-item.danger svg {
		color: var(--color-danger);
	}

	.dropdown-divider {
		height: 1px;
		background: var(--color-border);
		margin: 0.25rem 0;
	}

	.dropdown-header {
		display: none;
	}

	.pagination {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: var(--color-bg-elevated);
		border-top: 1px solid var(--color-border);
		border-radius: 0 0 var(--radius-md) var(--radius-md);
		margin-top: -1px;
	}

	.pagination-info {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.pagination-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.pagination-pages {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.pagination-btn {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		color: var(--color-text);
		text-decoration: none;
		transition: background 0.15s;
	}

	.pagination-btn:hover:not(.disabled):not(.current) {
		background: var(--color-bg-secondary);
	}

	.pagination-btn.current {
		background: var(--color-primary);
		color: white;
	}

	.pagination-btn.disabled {
		color: var(--color-text-muted);
		opacity: 0.5;
		cursor: not-allowed;
	}

	.pagination-ellipsis {
		padding: 0 0.25rem;
		color: var(--color-text-muted);
	}

	/* Mobile styles */
	@media (max-width: 768px) {
		.jobs-page {
			padding: 1rem;
		}

		.page-header h1 {
			font-size: 1.25rem;
		}

		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.bulk-actions {
			flex-direction: column;
		}

		.btn-secondary,
		.btn-danger {
			flex: 1;
			justify-content: center;
			text-align: center;
		}

		/* Card-based layout for mobile */
		.jobs-table-wrapper {
			background: transparent;
			overflow: visible;
		}

		.jobs-table {
			display: block;
		}

		.jobs-table thead {
			display: none;
		}

		.jobs-table tbody {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
		}

		.jobs-table tr {
			display: flex;
			flex-direction: column;
			background: var(--color-bg-elevated);
			border-radius: var(--radius-md);
			padding: 1rem;
			gap: 0.5rem;
			position: relative;
		}

		.jobs-table td {
			padding: 0;
			border: none;
		}

		.status-cell {
			position: absolute;
			top: 1rem;
			right: 1rem;
		}

		.filename-cell {
			max-width: calc(100% - 80px);
			order: -2;
		}

		.filename {
			font-weight: 500;
			font-size: 1rem;
		}

		.error-text {
			max-width: 100%;
		}

		.progress-cell {
			order: -1;
		}

		.length-cell,
		.proctime-cell,
		.date-cell {
			font-size: 0.75rem;
			opacity: 0.7;
		}

		.length-cell::before {
			content: 'Length: ';
		}

		.proctime-cell::before {
			content: 'Proc. time: ';
		}

		.date-cell::before {
			content: 'Created: ';
		}

		.actions-cell {
			width: auto;
			padding-top: 0.75rem;
			border-top: 1px solid var(--color-border);
			margin-top: 0.25rem;
		}

		.actions-wrapper {
			justify-content: flex-end;
		}

		.btn-menu {
			width: 40px;
			height: 40px;
		}

		.dropdown-menu {
			position: fixed;
			bottom: 1rem;
			left: 1rem;
			right: 1rem;
			top: auto;
			min-width: auto;
			margin-top: 0;
			border-radius: var(--radius-lg);
			box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
		}

		.dropdown-backdrop {
			background: rgba(0, 0, 0, 0.4);
		}

		.dropdown-item {
			padding: 0.75rem 1rem;
			font-size: 0.875rem;
		}

		.dropdown-header {
			display: block;
			padding: 0.875rem 1rem 0.625rem;
			font-weight: 600;
			font-size: 0.9375rem;
			color: var(--color-text);
			border-bottom: 1px solid var(--color-border);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.jobs-table tr.menu-open {
			background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-elevated));
			box-shadow: inset 0 0 0 2px var(--color-primary);
		}

		.pagination {
			flex-direction: column;
			gap: 0.75rem;
		}

		.pagination-pages {
			display: none;
		}

		.empty-state {
			padding: 2rem 1rem;
		}
	}
</style>
