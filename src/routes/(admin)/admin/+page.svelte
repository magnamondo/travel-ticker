<script lang="ts">
	let { data } = $props();
</script>

<div class="dashboard">
	<h1>Dashboard</h1>
	
	<div class="stats">
		<div class="stat-card">
			<span class="stat-value">{data.segmentCount}</span>
			<span class="stat-label">Segments</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.milestoneCount}</span>
			<span class="stat-label">Entries</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.mediaCount}</span>
			<span class="stat-label">Media Files</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.userCount}</span>
			<span class="stat-label">Users</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.commentCount}</span>
			<span class="stat-label">Comments</span>
		</div>
	</div>

	<div class="quick-actions">
		<h2>Quick Actions</h2>
		<div class="actions">
			<a href="/admin/entries" class="action-btn">Manage Entries</a>
			<a href="/admin/users" class="action-btn">Manage Users</a>
			<a href="/admin/comments" class="action-btn">Moderate Comments</a>
		</div>
	</div>
</div>

<style>
	.dashboard h1 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 2rem;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.stat-card {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.stat-value {
		font-size: 2rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.stat-label {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.quick-actions h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 1rem;
	}

	.actions {
		display: flex;
		gap: 1rem;
	}

	.action-btn {
		padding: 0.75rem 1.5rem;
		background: var(--color-primary);
		color: white;
		border-radius: var(--radius-md);
		text-decoration: none;
		font-weight: 500;
		transition: background 0.15s;
	}

	.action-btn:hover {
		background: var(--color-primary-hover);
	}

	/* Mobile styles */
	@media (max-width: 768px) {
		.dashboard h1 {
			font-size: 1.25rem;
			margin-bottom: 1.5rem;
		}

		.stats {
			grid-template-columns: 1fr;
		}

		.stat-card {
			padding: 1rem;
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
		}

		.stat-value {
			font-size: 1.5rem;
		}

		.actions {
			flex-direction: column;
		}

		.action-btn {
			text-align: center;
		}
	}
</style>
