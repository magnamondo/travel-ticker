<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { toasts } from '$lib/stores/toast.svelte';

	let { data, form } = $props();

	// Track last shown toast to avoid duplicates
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
	let editingGroup = $state<typeof data.groups[0] | null>(null);
	let managingGroup = $state<typeof data.groups[0] | null>(null);
	let groupMembers = $state<Array<{ id: string; email: string; role: string }>>([]);
	let activeTab = $state<'groups' | 'milestones'>('groups');

	function formatDate(date: Date | null) {
		if (!date) return '—';
		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(date);
	}

	async function loadGroupMembers(groupId: string) {
		const res = await fetch(`/api/groups/${groupId}/members`);
		if (res.ok) {
			groupMembers = await res.json();
		}
	}

	async function openManageMembers(group: typeof data.groups[0]) {
		managingGroup = group;
		await loadGroupMembers(group.id);
	}

	function getGroupsForMilestone(milestoneId: string): typeof data.groups {
		return data.milestoneGroupAssignments
			.filter(mg => mg.milestoneId === milestoneId)
			.map(mg => data.groups.find(g => g.id === mg.groupId))
			.filter((g): g is typeof data.groups[0] => g !== undefined);
	}

	function isGroupAssignedToMilestone(milestoneId: string, groupId: string) {
		return data.milestoneGroupAssignments.some(
			mg => mg.milestoneId === milestoneId && mg.groupId === groupId
		);
	}

	function getPublicMilestonesCount() {
		// A milestone is public if it has no group assignments
		const restrictedIds = new Set(data.milestoneGroupAssignments.map(mg => mg.milestoneId));
		return data.milestones.filter(m => !restrictedIds.has(m.id)).length;
	}

	function getRestrictedMilestonesCount() {
		const restrictedIds = new Set(data.milestoneGroupAssignments.map(mg => mg.milestoneId));
		return restrictedIds.size;
	}

	function isMilestonePublic(milestoneId: string) {
		return !data.milestoneGroupAssignments.some(mg => mg.milestoneId === milestoneId);
	}

	function getUsersNotInGroup(members: typeof groupMembers) {
		const memberIds = new Set(members.map(m => m.id));
		return data.users.filter(u => !memberIds.has(u.id));
	}
</script>

<div class="groups-page">
	<div class="page-header">
		<h1>Access Control</h1>
		<p class="subtitle">Manage groups and milestone visibility</p>
	</div>

	<!-- Tabs -->
	<div class="tabs">
		<button class="tab" class:active={activeTab === 'groups'} onclick={() => (activeTab = 'groups')}>
			Groups ({data.groups.length})
		</button>
		<button class="tab" class:active={activeTab === 'milestones'} onclick={() => (activeTab = 'milestones')}>
			Milestones ({data.milestones.length})
		</button>
	</div>

	<!-- Groups Tab -->
	{#if activeTab === 'groups'}
		<div class="stats-grid">
			<div class="stat-card">
				<span class="stat-value">{data.groups.length}</span>
				<span class="stat-label">Groups</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">{getPublicMilestonesCount()}</span>
				<span class="stat-label">Public Milestones</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">{getRestrictedMilestonesCount()}</span>
				<span class="stat-label">Restricted Milestones</span>
			</div>
		</div>

		<div class="actions-bar">
			<button class="btn btn-primary" onclick={() => (showCreateModal = true)}>
				+ New Group
			</button>
		</div>

		<div class="groups-list">
			{#each data.groups as group}
				<div class="group-card">
					<div class="group-header">
						<h3>{group.name}</h3>
						<div class="group-actions">
							<button class="btn btn-sm" onclick={() => (editingGroup = group)}>Edit</button>
							<button class="btn btn-sm" onclick={() => openManageMembers(group)}>Members</button>
						</div>
					</div>
					{#if group.description}
						<p class="group-description">{group.description}</p>
					{/if}
					<div class="group-meta">
						<span class="meta-item">👥 {group.memberCount} members</span>
						<span class="meta-item">📝 {group.milestoneCount} milestones</span>
						<span class="meta-item">Created {formatDate(group.createdAt)}</span>
					</div>
				</div>
			{:else}
				<div class="empty-state">
					<p>No groups yet. Create one to restrict content access.</p>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Milestones Tab -->
	{#if activeTab === 'milestones'}
		<div class="content-section">
			<p class="section-description">
				<strong>Public</strong> milestones (no groups assigned) are visible to everyone.
				<strong>Restricted</strong> milestones are only visible to members of assigned groups.
			</p>
			
			<div class="content-table">
				<table>
					<thead>
						<tr>
							<th>Milestone</th>
							<th>Segment</th>
							<th>Status</th>
							<th>Groups</th>
							<th>Add Group</th>
						</tr>
					</thead>
					<tbody>
						{#each data.milestones as milestone}
							<tr>
								<td><strong>{milestone.title}</strong></td>
								<td><span class="segment-ref">{milestone.segmentName}</span></td>
								<td>
									{#if isMilestonePublic(milestone.id)}
										<span class="access-badge public">🌐 Public</span>
									{:else}
										<span class="access-badge restricted">🔒 Restricted</span>
									{/if}
								</td>
								<td>
									<div class="group-tags">
										{#each getGroupsForMilestone(milestone.id) as group}
											<form method="POST" action="?/removeMilestoneGroup" use:enhance class="inline-form">
												<input type="hidden" name="milestoneId" value={milestone.id} />
												<input type="hidden" name="groupId" value={group.id} />
												<button type="submit" class="group-tag removable">
													{group.name} ✕
												</button>
											</form>
										{:else}
											<span class="no-groups">—</span>
										{/each}
									</div>
								</td>
								<td>
									<form method="POST" action="?/addMilestoneGroup" use:enhance class="add-group-form">
										<input type="hidden" name="milestoneId" value={milestone.id} />
										<select name="groupId" required>
											<option value="">Select group...</option>
											{#each data.groups as g}
												{#if !isGroupAssignedToMilestone(milestone.id, g.id)}
													<option value={g.id}>{g.name}</option>
												{/if}
											{/each}
										</select>
										<button type="submit" class="btn btn-sm btn-primary">Add</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>

<!-- Create Group Modal -->
{#if showCreateModal}
	<div class="modal-overlay" onclick={() => (showCreateModal = false)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h2>Create Group</h2>
			<form method="POST" action="?/createGroup" use:enhance={() => {
				return async ({ result, update }) => {
					await update();
					if (result.type === 'success') showCreateModal = false;
				};
			}}>
				<div class="form-group">
					<label for="name">Group Name</label>
					<input type="text" id="name" name="name" required />
				</div>
				<div class="form-group">
					<label for="description">Description (optional)</label>
					<textarea id="description" name="description" rows="3"></textarea>
				</div>
				<div class="modal-actions">
					<button type="button" class="btn" onclick={() => (showCreateModal = false)}>Cancel</button>
					<button type="submit" class="btn btn-primary">Create Group</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Edit Group Modal -->
{#if editingGroup}
	<div class="modal-overlay" onclick={() => (editingGroup = null)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h2>Edit Group</h2>
			<form method="POST" action="?/updateGroup" use:enhance={() => {
				return async ({ result, update }) => {
					await update();
					if (result.type === 'success') editingGroup = null;
				};
			}}>
				<input type="hidden" name="groupId" value={editingGroup.id} />
				<div class="form-group">
					<label for="edit-name">Group Name</label>
					<input type="text" id="edit-name" name="name" value={editingGroup.name} required />
				</div>
				<div class="form-group">
					<label for="edit-description">Description</label>
					<textarea id="edit-description" name="description" rows="3">{editingGroup.description ?? ''}</textarea>
				</div>
				<div class="modal-actions">
					<button type="button" class="btn" onclick={() => (editingGroup = null)}>Cancel</button>
					<button type="submit" class="btn btn-primary">Save Changes</button>
				</div>
			</form>
			<form method="POST" action="?/deleteGroup" use:enhance={() => {
				return async ({ result, update }) => {
					await update();
					if (result.type === 'success') editingGroup = null;
				};
			}} class="delete-form">
				<input type="hidden" name="groupId" value={editingGroup.id} />
				<button type="submit" class="btn btn-danger" onclick={(e) => {
					if (!confirm('Delete this group? Content access will be removed.')) e.preventDefault();
				}}>Delete Group</button>
			</form>
		</div>
	</div>
{/if}

<!-- Manage Members Modal -->
{#if managingGroup}
	<div class="modal-overlay" onclick={() => (managingGroup = null)}>
		<div class="modal modal-wide" onclick={(e) => e.stopPropagation()}>
			<h2>Manage Members: {managingGroup.name}</h2>
			
			<form method="POST" action="?/addMember" use:enhance={() => {
				return async ({ result, update }) => {
					await update();
					if (result.type === 'success' && managingGroup) {
						await loadGroupMembers(managingGroup.id);
					}
				};
			}} class="add-member-form">
				<input type="hidden" name="groupId" value={managingGroup.id} />
				<select name="userId" required>
					<option value="">Select user...</option>
					{#each getUsersNotInGroup(groupMembers) as user}
						<option value={user.id}>{user.email}</option>
					{/each}
				</select>
				<select name="role">
					<option value="member">Member</option>
					<option value="admin">Group Admin</option>
				</select>
				<button type="submit" class="btn btn-primary">Add Member</button>
			</form>

			<div class="members-list">
				{#each groupMembers as member}
					<div class="member-row">
						<span class="member-email">{member.email}</span>
						<span class="member-role">{member.role}</span>
						<form method="POST" action="?/removeMember" use:enhance={() => {
							return async ({ result, update }) => {
								await update();
								if (result.type === 'success' && managingGroup) {
									await loadGroupMembers(managingGroup.id);
								}
							};
						}}>
							<input type="hidden" name="groupId" value={managingGroup.id} />
							<input type="hidden" name="userId" value={member.id} />
							<button type="submit" class="btn btn-sm btn-danger">Remove</button>
						</form>
					</div>
				{:else}
					<p class="empty-members">No members in this group yet.</p>
				{/each}
			</div>

			<div class="modal-actions">
				<button type="button" class="btn" onclick={() => (managingGroup = null)}>Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.groups-page {
		padding: 2rem;
		max-width: 1200px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.subtitle, .section-description {
		color: var(--color-text-secondary);
		font-size: 0.875rem;
	}

	.tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-border);
		padding-bottom: 0.5rem;
	}

	.tab {
		padding: 0.5rem 1rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: 0.875rem;
		border-radius: 4px;
	}

	.tab:hover {
		background: var(--color-bg-secondary);
	}

	.tab.active {
		background: var(--color-primary);
		color: white;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.stat-card {
		background: var(--color-bg-secondary);
		padding: 1rem;
		border-radius: 8px;
		text-align: center;
	}

	.stat-value {
		display: block;
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-primary);
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-transform: uppercase;
	}

	.actions-bar {
		margin-bottom: 1.5rem;
	}

	.groups-list {
		display: grid;
		gap: 1rem;
	}

	.group-card {
		background: var(--color-bg-secondary);
		padding: 1.25rem;
		border-radius: 8px;
		border: 1px solid var(--color-border);
	}

	.group-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.group-header h3 {
		font-size: 1.125rem;
		font-weight: 600;
	}

	.group-actions {
		display: flex;
		gap: 0.5rem;
	}

	.group-description {
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		margin-bottom: 0.75rem;
	}

	.group-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.empty-state {
		text-align: center;
		padding: 3rem;
		color: var(--color-text-secondary);
	}

	.content-section {
		margin-top: 1rem;
	}

	.content-table {
		margin-top: 1rem;
		overflow-x: auto;
	}

	.content-table table {
		width: 100%;
		border-collapse: collapse;
	}

	.content-table th,
	.content-table td {
		padding: 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
		vertical-align: middle;
	}

	.content-table th {
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		color: var(--color-text-secondary);
	}

	.inline-form {
		display: inline;
	}

	.access-badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 500;
		border: none;
	}

	.access-badge.public {
		background: #10b98120;
		color: #10b981;
	}

	.access-badge.restricted {
		background: #f59e0b20;
		color: #f59e0b;
	}

	.group-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.group-tag {
		display: inline-block;
		background: var(--color-primary);
		color: white;
		padding: 0.125rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		border: none;
	}

	.group-tag.removable {
		cursor: pointer;
	}

	.group-tag.removable:hover {
		background: #ef4444;
	}

	.no-groups {
		color: var(--color-text-secondary);
		font-style: italic;
		font-size: 0.75rem;
	}

	.segment-ref {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.add-group-form {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.add-group-form select {
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.75rem;
	}

	/* Modal Styles */
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
		max-width: 400px;
		max-height: 90vh;
		overflow-y: auto;
	}

	.modal-wide {
		max-width: 600px;
	}

	.modal h2 {
		font-size: 1.25rem;
		margin-bottom: 1rem;
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group label {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		margin-bottom: 0.25rem;
	}

	.form-group input,
	.form-group textarea {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.5rem;
	}

	.add-member-form {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.add-member-form select {
		flex: 1;
		min-width: 150px;
		padding: 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.members-list {
		max-height: 300px;
		overflow-y: auto;
	}

	.member-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border);
	}

	.member-email {
		flex: 1;
	}

	.member-role {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-transform: capitalize;
	}

	.empty-members {
		color: var(--color-text-secondary);
		text-align: center;
		padding: 1rem;
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
	}

	.btn:hover {
		background: var(--color-bg-tertiary, #333);
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
		background: #ef4444;
		border-color: #ef4444;
		color: white;
	}

	.btn-sm {
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
	}

	@media (max-width: 768px) {
		.groups-page {
			padding: 1rem;
		}

		.group-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}

		.content-table {
			font-size: 0.875rem;
		}

		.add-group-form {
			flex-direction: column;
		}
	}
</style>
