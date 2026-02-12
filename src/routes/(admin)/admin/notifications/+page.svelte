<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { NOTIFICATION_TYPES } from '$lib/notification-types';

	let { data, form } = $props();

	let lastToastMessage = $state<string | null>(null);
	let openMenuId = $state<string | null>(null);
	let menuPosition = $state<{ top: number; right: number } | null>(null);

	function toggleMenu(notificationId: string, event: MouseEvent) {
		event.stopPropagation();
		if (openMenuId === notificationId) {
			openMenuId = null;
			menuPosition = null;
		} else {
			const button = event.currentTarget as HTMLElement;
			const rect = button.getBoundingClientRect();
			menuPosition = {
				top: rect.bottom + 4,
				right: window.innerWidth - rect.right
			};
			openMenuId = notificationId;
		}
	}

	function closeMenu() {
		openMenuId = null;
		menuPosition = null;
	}

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

	function getTypeLabel(typeId: string): string {
		return NOTIFICATION_TYPES.find(t => t.id === typeId)?.label ?? typeId;
	}

	function getStatusClass(status: string) {
		switch (status) {
			case 'sent': return 'status-sent';
			case 'failed': return 'status-failed';
			case 'cancelled': return 'status-cancelled';
			default: return 'status-pending';
		}
	}

	function getStatusIcon(status: string) {
		switch (status) {
			case 'sent': return '✅';
			case 'failed': return '❌';
			case 'cancelled': return '🚫';
			default: return '🕐';
		}
	}

	function getTimeUntilSend(sendAfter: Date): string {
		const now = new Date();
		const diff = sendAfter.getTime() - now.getTime();
		if (diff <= 0) return 'Ready';
		const mins = Math.ceil(diff / 60000);
		return mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
	}
</script>

<div class="notifications-page">
	<div class="page-header">
		<h1>Notification Queue</h1>
		<p class="subtitle">Monitor and manage email notifications</p>
	</div>

	<!-- Stats Cards -->
	<div class="stats-grid">
		<div class="stat-card">
			<span class="stat-value">{data.stats.total}</span>
			<span class="stat-label">Total</span>
		</div>
		<div class="stat-card pending">
			<span class="stat-value">{data.stats.pending}</span>
			<span class="stat-label">Pending</span>
		</div>
		<div class="stat-card sent">
			<span class="stat-value">{data.stats.sent}</span>
			<span class="stat-label">Sent</span>
		</div>
		<div class="stat-card cancelled">
			<span class="stat-value">{data.stats.cancelled}</span>
			<span class="stat-label">Cancelled</span>
		</div>
		<div class="stat-card failed">
			<span class="stat-value">{data.stats.failed}</span>
			<span class="stat-label">Failed</span>
		</div>
	</div>

	<!-- Recipient Preview -->
	<div class="recipient-preview">
		<div class="preview-header">
			<span class="preview-icon">📬</span>
			<span class="preview-title">Recipient Preview</span>
		</div>
		<div class="preview-content">
			<div class="preview-stat">
				<span class="preview-value">{data.recipientInfo.subscriberCount}</span>
				<span class="preview-label">users subscribed to milestone notifications</span>
			</div>
			<div class="preview-stat">
				<span class="preview-value">{data.recipientInfo.pendingMilestones}</span>
				<span class="preview-label">milestones awaiting notification</span>
			</div>
		</div>
		{#if data.stats.pending > 0 && data.recipientInfo.subscriberCount > 0 && data.recipientInfo.pendingMilestones > 0}
			<p class="preview-note">When processed, up to {data.recipientInfo.subscriberCount} emails will be sent (filtered by group access)</p>
		{/if}
	</div>

	<!-- Bulk Actions -->
	<div class="bulk-actions">
		<form method="POST" action="?/deleteAll" use:enhance>
			<input type="hidden" name="status" value="sent" />
			<button type="submit" class="btn-secondary" disabled={data.stats.sent === 0}>
				🗑️ Clear Sent ({data.stats.sent})
			</button>
		</form>
		<form method="POST" action="?/deleteAll" use:enhance>
			<input type="hidden" name="status" value="cancelled" />
			<button type="submit" class="btn-secondary" disabled={data.stats.cancelled === 0}>
				🗑️ Clear Cancelled ({data.stats.cancelled})
			</button>
		</form>
		<form method="POST" action="?/deleteAll" use:enhance>
			<input type="hidden" name="status" value="failed" />
			<button type="submit" class="btn-secondary" disabled={data.stats.failed === 0}>
				🗑️ Clear Failed ({data.stats.failed})
			</button>
		</form>
		<form method="POST" action="?/deleteAll" use:enhance onsubmit={(e) => { if (!confirm('Delete ALL notifications? This cannot be undone.')) e.preventDefault(); }}>
			<input type="hidden" name="status" value="all" />
			<button type="submit" class="btn-danger" disabled={data.stats.total === 0}>
				🗑️ Clear All
			</button>
		</form>
	</div>

	<!-- Notifications Table -->
	{#if data.notifications.length === 0}
		<div class="empty-state">
			<span class="empty-icon">📧</span>
			<p>No notifications in queue</p>
			<p class="empty-hint">Notifications appear here when milestones are published</p>
		</div>
	{:else}
		<div class="table-wrapper">
			<table class="data-table">
				<thead>
					<tr>
						<th>Status</th>
						<th>Type</th>
						<th>Group Key</th>
						<th>Send After</th>
						<th>Created</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.notifications as notification (notification.id)}
						<tr class="{getStatusClass(notification.status)}" class:menu-open={openMenuId === notification.id}>
							<td class="status-cell">
								<span class="status-badge {notification.status}">
									{getStatusIcon(notification.status)} {notification.status}
								</span>
							</td>
							<td class="type-cell">
								<span class="type-label">{getTypeLabel(notification.typeId)}</span>
							</td>
							<td class="groupkey-cell">
								<span class="groupkey" title={notification.groupKey}>{notification.groupKey}</span>
							</td>
							<td class="sendafter-cell">
								{#if notification.status === 'pending'}
									<span class="time-until">{getTimeUntilSend(notification.sendAfter)}</span>
								{:else}
									<span class="date-text">{formatDate(notification.sendAfter)}</span>
								{/if}
								{#if notification.error}
									<span class="error-text" title={notification.error}>⚠️ {notification.error}</span>
								{/if}
							</td>
							<td class="date-cell">{formatDate(notification.createdAt)}</td>
							<td class="actions-cell">
								<div class="actions-wrapper">
									<div class="dropdown">
										<button 
											class="btn-menu" 
											onclick={(e) => toggleMenu(notification.id, e)}
											aria-label="More actions"
										>
											<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="2"/><circle cx="10" cy="10" r="2"/><circle cx="16" cy="10" r="2"/></svg>
										</button>
										{#if openMenuId === notification.id}
											<button class="dropdown-backdrop" onclick={closeMenu} aria-label="Close menu"></button>
											<div class="dropdown-menu" style={menuPosition ? `top: ${menuPosition.top}px; right: ${menuPosition.right}px;` : ''}>
												<div class="dropdown-header">{getTypeLabel(notification.typeId)}</div>
												{#if notification.status === 'pending'}
													<form method="POST" action="?/cancel" use:enhance={() => {
														return async ({ update }) => {
															closeMenu();
															await update();
														};
													}}>
														<input type="hidden" name="notificationId" value={notification.id} />
														<button type="submit" class="dropdown-item">
															🚫 Cancel
														</button>
													</form>
												{/if}
												{#if notification.status === 'failed' || notification.status === 'cancelled'}
													<form method="POST" action="?/retry" use:enhance={() => {
														return async ({ update }) => {
															closeMenu();
															await update();
														};
													}}>
														<input type="hidden" name="notificationId" value={notification.id} />
														<button type="submit" class="dropdown-item">
															🔄 Retry
														</button>
													</form>
												{/if}
												<div class="dropdown-divider"></div>
												<form method="POST" action="?/delete" use:enhance={() => {
													return async ({ update }) => {
														closeMenu();
														await update();
													};
												}}>
													<input type="hidden" name="notificationId" value={notification.id} />
													<button 
														type="submit" 
														class="dropdown-item danger"
														onclick={(e) => { if (!confirm('Delete this notification?')) e.preventDefault(); }}
													>
														🗑️ Delete
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

<style>
	.notifications-page {
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
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
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
	.stat-card.sent { border-left: 3px solid #10b981; }
	.stat-card.cancelled { border-left: 3px solid #6b7280; }
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

	.recipient-preview {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		padding: 1rem 1.25rem;
		margin-bottom: 1.5rem;
		border-left: 3px solid #3b82f6;
	}

	.preview-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.preview-icon {
		font-size: 1rem;
	}

	.preview-title {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.preview-content {
		display: flex;
		gap: 2rem;
		flex-wrap: wrap;
	}

	.preview-stat {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.preview-value {
		font-size: 1.25rem;
		font-weight: 600;
		color: #3b82f6;
	}

	.preview-label {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.preview-note {
		margin-top: 0.75rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		font-style: italic;
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

	.table-wrapper {
		overflow-x: auto;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.data-table th {
		text-align: left;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		font-weight: 500;
		font-size: 0.75rem;
		text-transform: uppercase;
		border-bottom: 1px solid var(--color-border);
	}

	.data-table td {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		vertical-align: middle;
	}

	.data-table tbody tr:last-child td {
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

	.status-badge.sent {
		background: rgba(16, 185, 129, 0.1);
		color: #10b981;
	}

	.status-badge.cancelled {
		background: rgba(107, 114, 128, 0.1);
		color: #6b7280;
	}

	.status-badge.failed {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	.type-cell {
		max-width: 150px;
	}

	.type-label {
		font-weight: 500;
	}

	.groupkey-cell {
		max-width: 200px;
	}

	.groupkey {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: monospace;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.sendafter-cell {
		white-space: nowrap;
	}

	.time-until {
		font-weight: 500;
		color: #f59e0b;
	}

	.date-text {
		color: var(--color-text-muted);
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

	.date-cell {
		white-space: nowrap;
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
		position: fixed;
		min-width: 140px;
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
		gap: 0.5rem;
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

	.dropdown-item.danger {
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

	@media (max-width: 768px) {
		.notifications-page {
			padding: 1rem;
		}

		.page-header h1 {
			font-size: 1.25rem;
		}

		.stats-grid {
			grid-template-columns: repeat(3, 1fr);
		}

		.bulk-actions {
			flex-direction: column;
		}

		.bulk-actions form {
			width: 100%;
		}

		.btn-secondary,
		.btn-danger {
			width: 100%;
			justify-content: center;
			text-align: center;
		}

		/* Card-based layout for mobile */
		.table-wrapper {
			background: transparent;
			overflow: visible;
		}

		.data-table {
			display: block;
		}

		.data-table thead {
			display: none;
		}

		.data-table tbody {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
		}

		.data-table tr {
			display: flex;
			flex-direction: column;
			background: var(--color-bg-elevated);
			border-radius: var(--radius-md);
			padding: 1rem;
			gap: 0.5rem;
			position: relative;
		}

		.data-table td {
			padding: 0;
			border: none;
		}

		.status-cell {
			position: absolute;
			top: 1rem;
			right: 1rem;
		}

		.type-cell {
			max-width: calc(100% - 80px);
			order: -2;
		}

		.type-label {
			font-size: 1rem;
		}

		.groupkey-cell {
			max-width: 100%;
			order: -1;
		}

		.sendafter-cell,
		.date-cell {
			font-size: 0.75rem;
			opacity: 0.7;
		}

		.sendafter-cell::before {
			content: 'Send after: ';
		}

		.date-cell::before {
			content: 'Created: ';
		}

		.error-text {
			max-width: 100%;
		}

		.time-until {
			opacity: 1;
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
			bottom: 1rem !important;
			left: 1rem !important;
			right: 1rem !important;
			top: auto !important;
			min-width: auto;
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

		.data-table tr.menu-open {
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
