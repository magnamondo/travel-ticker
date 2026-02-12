<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { ROLES, getRoleLabel } from '$lib/roles';
	import { toasts } from '$lib/stores/toast.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	let { data, form } = $props();

	// Track last shown toast to avoid duplicates
	let lastToastMessage = $state<string | null>(null);

	// ConfirmDialog state
	let revokeSessionsDialogOpen = $state(false);
	let pendingRevokeUser = $state<{ id: string; email: string } | null>(null);
	let deleteUserDialogOpen = $state(false);
	let pendingDeleteUser = $state<{ id: string; email: string } | null>(null);

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

	let showCreateModal = $state(false);
	let editingUserId = $state<string | null>(null);
	let showPasswordModal = $state<string | null>(null);
	let newPassword = $state('');
	let searchQuery = $state('');
	let openMenuId = $state<string | null>(null);

	function toggleMenu(userId: string, event: MouseEvent) {
		event.stopPropagation();
		openMenuId = openMenuId === userId ? null : userId;
	}

	function closeMenu() {
		openMenuId = null;
	}

	// ConfirmDialog handlers
	function requestRevokeSessions(userId: string, email: string) {
		pendingRevokeUser = { id: userId, email };
		revokeSessionsDialogOpen = true;
	}

	function confirmRevokeSessions() {
		if (!pendingRevokeUser) return;
		const form = document.getElementById(`revoke-sessions-${pendingRevokeUser.id}`) as HTMLFormElement;
		revokeSessionsDialogOpen = false;
		closeMenu();
		pendingRevokeUser = null;
		form?.requestSubmit();
	}

	function cancelRevokeSessions() {
		revokeSessionsDialogOpen = false;
		pendingRevokeUser = null;
	}

	function requestDeleteUser(userId: string, email: string) {
		pendingDeleteUser = { id: userId, email };
		deleteUserDialogOpen = true;
	}

	function confirmDeleteUser() {
		if (!pendingDeleteUser) return;
		const form = document.getElementById(`delete-user-${pendingDeleteUser.id}`) as HTMLFormElement;
		deleteUserDialogOpen = false;
		closeMenu();
		pendingDeleteUser = null;
		form?.requestSubmit();
	}

	function cancelDeleteUser() {
		deleteUserDialogOpen = false;
		pendingDeleteUser = null;
	}

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
					<tr class:menu-open={openMenuId === user.id}>
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
							<div class="actions-wrapper">
								<button class="btn-edit" onclick={() => (editingUserId = user.id)}>
									Edit
								</button>
								<div class="dropdown">
									<button 
										class="btn-menu" 
										onclick={(e) => toggleMenu(user.id, e)}
										aria-label="More actions"
									>
										<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="2"/><circle cx="10" cy="10" r="2"/><circle cx="16" cy="10" r="2"/></svg>
									</button>
									{#if openMenuId === user.id}
										<button class="dropdown-backdrop" onclick={closeMenu} aria-label="Close menu"></button>
										<div class="dropdown-menu">
											<div class="dropdown-header">{getDisplayName(user)}</div>
											<button class="dropdown-item" onclick={() => { closeMenu(); showPasswordModal = user.id; }}>
												<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 7a5 5 0 113.61 4.804l-1.903 1.903A1 1 0 019 14H8v1a1 1 0 01-1 1H6v1a1 1 0 01-1 1H3a1 1 0 01-1-1v-2a1 1 0 01.293-.707L8.196 8.39A5.002 5.002 0 018 7zm5-3a.75.75 0 000 1.5A1.5 1.5 0 0114.5 7 .75.75 0 0016 7a3 3 0 00-3-3z" clip-rule="evenodd"/></svg>
												Reset password
											</button>
											{#if !user.emailVerified}
												<form method="POST" action="?/verifyEmail" use:enhance={() => {
													return async ({ update }) => {
														closeMenu();
														await update();
													};
												}}>
													<input type="hidden" name="userId" value={user.id} />
													<button type="submit" class="dropdown-item">
														<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>
														Verify email
													</button>
												</form>
											{/if}
											<form id="revoke-sessions-{user.id}" method="POST" action="?/revokeAllSessions" use:enhance={() => {
												return async ({ update }) => {
													closeMenu();
													await update();
												};
											}}>
												<input type="hidden" name="userId" value={user.id} />
												<button 
													type="button" 
													class="dropdown-item"
													onclick={() => requestRevokeSessions(user.id, user.email)}
												>
													<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zM6.39 6.39a.75.75 0 011.06 0L10 8.94l2.55-2.55a.75.75 0 111.06 1.06L11.06 10l2.55 2.55a.75.75 0 11-1.06 1.06L10 11.06l-2.55 2.55a.75.75 0 01-1.06-1.06L8.94 10 6.39 7.45a.75.75 0 010-1.06z" clip-rule="evenodd"/></svg>
													Revoke sessions
												</button>
											</form>
											<div class="dropdown-divider"></div>
											<form id="delete-user-{user.id}" method="POST" action="?/delete" use:enhance={() => {
												return async ({ update }) => {
													closeMenu();
													await update();
												};
											}}>
												<input type="hidden" name="userId" value={user.id} />
												<button 
													type="button" 
													class="dropdown-item danger"
													onclick={() => requestDeleteUser(user.id, user.email)}
												>
													<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>
													Delete user
												</button>
											</form>
										</div>
									{/if}
								</div>
							</div>
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
					<div class="form-group">
						<label class="checkbox-label">
							<input type="checkbox" name="newMilestonesNotification" checked={editUser.profile?.notificationPreferences?.new_milestones !== false} />
							<span>Receive milestone notifications</span>
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

<ConfirmDialog
	open={revokeSessionsDialogOpen}
	title="Revoke Sessions"
	message={`Revoke all sessions for ${pendingRevokeUser?.email ?? ''}? They will be logged out everywhere.`}
	confirmText="Revoke"
	variant="warning"
	onconfirm={confirmRevokeSessions}
	oncancel={cancelRevokeSessions}
/>

<ConfirmDialog
	open={deleteUserDialogOpen}
	title="Delete User"
	message={`Delete user ${pendingDeleteUser?.email ?? ''}? This cannot be undone.`}
	confirmText="Delete"
	variant="danger"
	onconfirm={confirmDeleteUser}
	oncancel={cancelDeleteUser}
/>

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
		overflow: visible;
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
		width: 140px;
	}

	.actions-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.btn-edit {
		padding: 0.375rem 0.75rem;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		transition: all 0.15s;
	}

	.btn-edit:hover {
		background: var(--color-bg-hover);
		border-color: var(--color-text-muted);
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

		/* Card-based layout for mobile */
		.table-container {
			background: transparent;
		}

		.users-table {
			display: block;
		}

		.users-table thead {
			display: none;
		}

		.users-table tbody {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
		}

		.users-table tr {
			display: flex;
			flex-direction: column;
			background: var(--color-bg-elevated);
			border-radius: var(--radius-md);
			padding: 1rem;
			gap: 0.75rem;
		}

		.users-table td {
			padding: 0;
			border: none;
		}

		.user-cell {
			gap: 0.75rem;
		}

		.user-avatar {
			width: 40px;
			height: 40px;
			font-size: 1rem;
		}

		.user-name {
			font-size: 1rem;
		}

		.email-cell {
			font-size: 0.8125rem;
			word-break: break-all;
		}

		.users-table td:nth-child(3),
		.users-table td:nth-child(4) {
			display: inline-flex;
		}

		/* Put status and role badges inline */
		.users-table tr > td:nth-child(3) {
			position: absolute;
			top: 1rem;
			right: 1rem;
		}

		.users-table tr {
			position: relative;
		}

		.users-table td:nth-child(4) {
			order: -1;
			margin-top: -0.25rem;
		}

		.date-cell {
			font-size: 0.75rem;
			opacity: 0.7;
		}

		.date-cell::before {
			content: 'Joined ';
		}

		.actions-cell {
			width: auto;
			padding-top: 0.75rem;
			border-top: 1px solid var(--color-border);
			margin-top: 0.25rem;
		}

		.btn-edit {
			padding: 0.5rem 1rem;
			font-size: 0.875rem;
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
		}

		.users-table tr.menu-open {
			background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-elevated));
			box-shadow: inset 0 0 0 2px var(--color-primary);
		}

		.empty-state {
			background: var(--color-bg-elevated);
			border-radius: var(--radius-md);
			padding: 2rem 1rem !important;
		}

		.form-row {
			grid-template-columns: 1fr;
		}

		.modal {
			padding: 1.25rem;
			max-height: 85vh;
		}
	}
</style>
