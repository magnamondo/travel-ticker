<script lang="ts">
	import { enhance } from '$app/forms';
	import { toasts } from '$lib/stores/toast.svelte';

	let { data, form } = $props();

	// Show toast when form result changes
	$effect(() => {
		if (form?.success && form?.message) {
			toasts.success(form.message);
		} else if (form?.error) {
			toasts.error(form.error);
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

	function formatDuration(seconds: number | null) {
		if (!seconds) return '—';
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
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
		<form method="POST" action="?/deleteAll" use:enhance onsubmit={(e) => { if (!confirm('Delete ALL jobs? This cannot be undone.')) e.preventDefault(); }}>
			<input type="hidden" name="status" value="all" />
			<button type="submit" class="btn-danger" disabled={data.stats.total === 0}>
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
						<th>Duration</th>
						<th>Created</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.jobs as job (job.id)}
						<tr class={getStatusClass(job.status)}>
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
							<td>{formatDuration(job.duration)}</td>
							<td class="date-cell">{formatDate(job.createdAt)}</td>
							<td class="actions-cell">
								{#if job.status === 'failed'}
									<form method="POST" action="?/retry" use:enhance class="inline">
										<input type="hidden" name="jobId" value={job.id} />
										<button type="submit" class="btn-icon" title="Retry">🔄</button>
									</form>
								{/if}
								{#if job.resultUrl}
									<a href={job.resultUrl} target="_blank" class="btn-icon" title="View result">🎬</a>
								{/if}
								{#if job.thumbnailUrl}
									<a href={job.thumbnailUrl} target="_blank" class="btn-icon" title="View thumbnail">🖼️</a>
								{/if}
								<form method="POST" action="?/delete" use:enhance class="inline" onsubmit={(e) => { if (!confirm('Delete this job?')) e.preventDefault(); }}>
									<input type="hidden" name="jobId" value={job.id} />
									<button type="submit" class="btn-icon danger" title="Delete">×</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

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

	.actions-cell {
		white-space: nowrap;
	}

	.inline {
		display: inline;
	}

	.btn-icon {
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
	}

	.btn-icon:hover {
		background: var(--color-bg-secondary);
	}

	.btn-icon.danger:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	@media (max-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.jobs-table th:nth-child(4),
		.jobs-table td:nth-child(4),
		.jobs-table th:nth-child(5),
		.jobs-table td:nth-child(5) {
			display: none;
		}
	}
</style>
