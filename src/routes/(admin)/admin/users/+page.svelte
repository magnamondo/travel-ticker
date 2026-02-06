<script lang="ts">
	import { enhance } from '$app/forms';
	import { ROLES, getRoleLabel } from '$lib/roles';
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

	let showCreateModal = $state(false);
	let editingUserId = $state<string | null>(null);
	let showPasswordModal = $state<string | null>(null);
	let newPassword = $state('');
	let searchQuery = $state('');

	function formatDate(date: Date | null) {
		if (!date) return '—';
		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(date);
	}

	function getDisplayName(user: typeof data.users[0]) {
		if (user.profile?.firstName || user.profile?.lastName) {
			return [user.profile.firstName, user.profile.lastName].filter(Boolean).join(' ');
		}
		return user.email.split('@')[0];
	}

	const filteredUsers = $derived(
		searchQuery
			? data.users.filter(u => 
					u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
					(u.profile?.firstName?.toLowerCase().includes(searchQuery.toLowerCase())) ||
					(u.profile?.lastName?.toLowerCase().includes(searchQuery.toLowerCase()))
				)
			: data.users
	);

	function getPrimaryRole(roles: string[] | null): string {
		if (!roles || roles.length === 0) return 'reader';
		// Return first matching role in hierarchy order
		for (const role of ROLES) {
			if (roles.includes(role)) return role;
		}
		return 'reader';
	}
</script>

<div class="users-page">
	<div class="page-header">
		<h1>User Management</h1>
		<p class="subtitle">Manage user accounts and permissions</p>
	</div>

	<!-- Stats -->
	<div class="stats-grid">
		<div class="stat-card">
			<span class="stat-value">{data.stats.total}</span>
			<span class="stat-label">Total Users</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.stats.verified}</span>
			<span class="stat-label">Verified</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.stats.unverified}</span>
			<span class="stat-label">Unverified</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.stats.admins}</span>
			<span class="stat-label">Admins</span>
		</div>
	</div>

	<!-- Actions Bar -->
	<div class="actions-bar">
		<input 
			type="search" 
			placeholder="Search users..." 
			bind:value={searchQuery}
			class="search-input"
		/>
		<button class="btn-primary" onclick={() => (showCreateModal = true)}>
			+ Add User
		</button>
	</div>

	<!-- Users Table -->
	<div class="table-container">
		<table class="users-table">
			<thead>
				<tr>
					<th>User</th>
					<th>Email</th>
					<th>Status</th>
					<th>Role</th>
					<th>Created</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredUsers as user (user.id)}
					<tr>
						<td class="user-cell">
							<div class="user-avatar">
								{getDisplayName(user).charAt(0).toUpperCase()}
							</div>
							<span class="user-name">{getDisplayName(user)}</span>
						</td>
						<td class="email-cell">{user.email}</td>
						<td>
							<span class="status-badge" class:verified={user.emailVerified} class:unverified={!user.emailVerified}>
								{user.emailVerified ? 'Verified' : 'Unverified'}
							</span>
						</td>
						<td>
							<span class="role-badge" class:admin={user.roles?.includes('admin')} class:writer={user.roles?.includes('writer')} class:reactor={user.roles?.includes('reactor')}>
								{getRoleLabel(getPrimaryRole(user.roles) as 'admin' | 'writer' | 'reactor' | 'reader')}
							</span>
						</td>
						<td class="date-cell">{formatDate(user.createdAt)}</td>
						<td class="actions-cell">
							<button class="btn-icon" title="Edit" onclick={() => (editingUserId = user.id)}>✏️</button>
							<button class="btn-icon" title="Reset Password" onclick={() => (showPasswordModal = user.id)}>🔑</button>
							{#if !user.emailVerified}
								<form method="POST" action="?/verifyEmail" use:enhance class="inline">
									<input type="hidden" name="userId" value={user.id} />
									<button type="submit" class="btn-icon" title="Verify Email">✅</button>
								</form>
							{/if}
							<form method="POST" action="?/revokeAllSessions" use:enhance class="inline">
								<input type="hidden" name="userId" value={user.id} />
								<button type="submit" class="btn-icon" title="Revoke Sessions">🔐</button>
							</form>
							<form method="POST" action="?/delete" use:enhance class="inline">
								<input type="hidden" name="userId" value={user.id} />
								<button 
									type="submit" 
									class="btn-icon danger" 
									title="Delete"
									onclick={(e) => { if (!confirm(`Delete user ${user.email}?`)) e.preventDefault(); }}
								>🗑️</button>
							</form>
						</td>
					</tr>
				{/each}
				{#if filteredUsers.length === 0}
					<tr>
						<td colspan="6" class="empty-state">
							{searchQuery ? 'No users match your search' : 'No users found'}
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>

<!-- Create User Modal -->
{#if showCreateModal}
	<div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
		<button class="modal-backdrop" onclick={() => (showCreateModal = false)} aria-label="Close modal"></button>
		<div class="modal">
			<h2 id="create-user-title">Create New User</h2>
			<form method="POST" action="?/create" use:enhance={() => {
				return async ({ result }) => {
					if (result.type === 'success') {
						showCreateModal = false;
					}
					window.location.reload();
				};
			}}>
				<div class="form-row">
					<div class="form-group">
						<label for="firstName">First Name</label>
						<input type="text" id="firstName" name="firstName" />
					</div>
					<div class="form-group">
						<label for="lastName">Last Name</label>
						<input type="text" id="lastName" name="lastName" />
					</div>
				</div>
				<div class="form-group">
					<label for="email">Email *</label>
					<input type="email" id="email" name="email" required />
				</div>
				<div class="form-group">
					<label for="password">Password *</label>
					<input type="password" id="password" name="password" required minlength="8" />
					<span class="hint">Minimum 8 characters</span>
				</div>
				<div class="form-group">
					<label for="role">Role *</label>
					<select id="role" name="role" required class="role-select">
						{#each ROLES as role}
							<option value={role} selected={role === 'reader'}>{getRoleLabel(role)}</option>
						{/each}
					</select>
					<span class="hint">
						Admin: Full access • Writer: Comments & reactions • Reactor: Reactions only • Reader: View only
					</span>
				</div>
				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" name="emailVerified" checked />
						<span>Email verified</span>
					</label>
				</div>
				<div class="modal-actions">
					<button type="button" class="btn-secondary" onclick={() => (showCreateModal = false)}>Cancel</button>
					<button type="submit" class="btn-primary">Create User</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Edit User Modal -->
{#if editingUserId}
	{@const editUser = data.users.find(u => u.id === editingUserId)}
	{#if editUser}
		<div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
			<button class="modal-backdrop" onclick={() => (editingUserId = null)} aria-label="Close modal"></button>
			<div class="modal">
				<h2 id="edit-user-title">Edit User</h2>
				<form method="POST" action="?/update" use:enhance={() => {
					return async () => {
						editingUserId = null;
						window.location.reload();
					};
				}}>
					<input type="hidden" name="userId" value={editUser.id} />
					<div class="form-row">
						<div class="form-group">
							<label for="edit-firstName">First Name</label>
							<input type="text" id="edit-firstName" name="firstName" value={editUser.profile?.firstName || ''} />
						</div>
						<div class="form-group">
							<label for="edit-lastName">Last Name</label>
							<input type="text" id="edit-lastName" name="lastName" value={editUser.profile?.lastName || ''} />
						</div>
					</div>
					<div class="form-group">
						<label for="edit-email">Email *</label>
						<input type="email" id="edit-email" name="email" value={editUser.email} required />
					</div>
					<div class="form-group">
						<label for="edit-role">Role *</label>
						<select id="edit-role" name="role" required class="role-select">
							{#each ROLES as role}
								<option value={role} selected={getPrimaryRole(editUser.roles) === role}>{getRoleLabel(role)}</option>
							{/each}
						</select>
						<span class="hint">
							Admin: Full access • Writer: Comments & reactions • Reactor: Reactions only • Reader: View only
						</span>
					</div>
					<div class="form-group">
						<label class="checkbox-label">
							<input type="checkbox" name="emailVerified" checked={editUser.emailVerified} />
							<span>Email verified</span>
						</label>
					</div>
					<div class="modal-actions">
						<button type="button" class="btn-secondary" onclick={() => (editingUserId = null)}>Cancel</button>
						<button type="submit" class="btn-primary">Save Changes</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
{/if}

<!-- Reset Password Modal -->
{#if showPasswordModal}
	<div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
		<button class="modal-backdrop" onclick={() => { showPasswordModal = null; newPassword = ''; }} aria-label="Close modal"></button>
		<div class="modal">
			<h2 id="reset-password-title">Reset Password</h2>
			<form method="POST" action="?/resetPassword" use:enhance={() => {
				return async () => {
					showPasswordModal = null;
					newPassword = '';
					window.location.reload();
				};
			}}>
				<input type="hidden" name="userId" value={showPasswordModal} />
				<div class="form-group">
					<label for="newPassword">New Password *</label>
					<input 
						type="password" 
						id="newPassword" 
						name="newPassword" 
						required 
						minlength="8"
						bind:value={newPassword}
					/>
					<span class="hint">Minimum 8 characters</span>
				</div>
				<div class="modal-actions">
					<button type="button" class="btn-secondary" onclick={() => { showPasswordModal = null; newPassword = ''; }}>Cancel</button>
					<button type="submit" class="btn-primary">Reset Password</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.users-page {
		padding: 1.5rem;
		max-width: 1200px;
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
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
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

	.actions-bar {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
		align-items: center;
	}

	.search-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.875rem;
	}

	.search-input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.btn-primary {
		padding: 0.5rem 1rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s;
	}

	.btn-primary:hover {
		background: var(--color-primary-hover);
	}

	.btn-secondary {
		padding: 0.5rem 1rem;
		background: var(--color-bg-elevated);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.btn-secondary:hover {
		background: var(--color-bg-hover);
	}

	.table-container {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.users-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.users-table th {
		text-align: left;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		font-weight: 500;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--color-border);
	}

	.users-table td {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.users-table tr:last-child td {
		border-bottom: none;
	}

	.user-cell {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.user-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--color-primary);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: 0.875rem;
	}

	.user-name {
		font-weight: 500;
	}

	.email-cell {
		color: var(--color-text-muted);
	}

	.date-cell {
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	.status-badge {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.status-badge.verified {
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-success);
	}

	.status-badge.unverified {
		background: color-mix(in srgb, var(--color-warning) 15%, transparent);
		color: var(--color-warning);
	}

	.role-badge {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 500;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
	}

	.role-badge.admin {
		background: color-mix(in srgb, var(--color-primary) 15%, transparent);
		color: var(--color-primary);
	}

	.role-badge.writer {
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-success);
	}

	.role-badge.reactor {
		background: color-mix(in srgb, var(--color-warning) 15%, transparent);
		color: var(--color-warning);
	}

	.role-select {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.role-select:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.actions-cell {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.btn-icon {
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 0.875rem;
		transition: background 0.15s;
	}

	.btn-icon:hover {
		background: var(--color-bg-hover);
	}

	.btn-icon.danger:hover {
		background: color-mix(in srgb, var(--color-danger) 15%, transparent);
	}

	.inline {
		display: inline;
	}

	.empty-state {
		text-align: center;
		color: var(--color-text-muted);
		padding: 2rem !important;
	}

	/* Modal styles */
	.modal-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 1000;
	}

	.modal-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		border: none;
		cursor: pointer;
	}

	.modal {
		position: relative;
		background: var(--color-bg-elevated);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		width: 100%;
		max-width: 480px;
		max-height: 90vh;
		overflow-y: auto;
		z-index: 1;
	}

	.modal h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 1.5rem;
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group label {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		margin-bottom: 0.375rem;
	}

	.form-group input[type="text"],
	.form-group input[type="email"],
	.form-group input[type="password"] {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.875rem;
	}

	.form-group input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.form-group .hint {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"] {
		width: 16px;
		height: 16px;
		accent-color: var(--color-primary);
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	/* Mobile styles */
	@media (max-width: 768px) {
		.users-page {
			padding: 1rem;
		}

		.page-header h1 {
			font-size: 1.25rem;
		}

		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.actions-bar {
			flex-direction: column;
			align-items: stretch;
		}

		.table-container {
			overflow-x: auto;
		}

		.users-table {
			min-width: 600px;
		}

		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
