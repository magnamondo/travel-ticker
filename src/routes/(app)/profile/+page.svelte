<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	function formatDate(date: Date | null): string {
		if (!date) return '';
		return new Date(date).toISOString().split('T')[0];
	}
</script>

<svelte:head>
	<title>Edit Profile / Magnamondo</title>
</svelte:head>

<div class="profile-page">
	<h1>Edit Profile</h1>

	<div class="profile-section">
		<div class="section-header">
			<h2>Account</h2>
		</div>
		<div class="account-info">
			<div class="info-row">
				<span class="info-label">Email</span>
				<span class="info-value">{data.user.email}</span>
			</div>
		</div>
	</div>

	<form method="post" action="?/updateProfile" use:enhance class="profile-form">
		<div class="profile-section">
			<div class="section-header">
				<h2>Personal Information</h2>
			</div>

			<div class="form-grid">
				<label class="form-field">
					<span class="form-label">Title</span>
					<select name="title" value={data.profile?.title ?? ''}>
						<option value="">Select...</option>
						<option value="Mr">Mr</option>
						<option value="Mrs">Mrs</option>
						<option value="Ms">Ms</option>
						<option value="Dr">Dr</option>
						<option value="Prof">Prof</option>
					</select>
				</label>

				<div class="form-spacer"></div>

				<label class="form-field">
					<span class="form-label">First Name</span>
					<input
						type="text"
						name="firstName"
						value={data.profile?.firstName ?? ''}
						placeholder="Enter your first name"
					/>
				</label>

				<label class="form-field">
					<span class="form-label">Last Name</span>
					<input
						type="text"
						name="lastName"
						value={data.profile?.lastName ?? ''}
						placeholder="Enter your last name"
					/>
				</label>

				<label class="form-field">
					<span class="form-label">Date of Birth</span>
					<input
						type="date"
						name="dateOfBirth"
						value={formatDate(data.profile?.dateOfBirth ?? null)}
					/>
				</label>

				<label class="form-field">
					<span class="form-label">Phone Number</span>
					<input
						type="tel"
						name="phoneNumber"
						value={data.profile?.phoneNumber ?? ''}
						placeholder="+1 234 567 8900"
					/>
				</label>
			</div>
		</div>

		<div class="form-actions">
			<button type="submit" class="btn btn-primary">Save Changes</button>
		</div>

		{#if form?.success}
			<p class="success-message">Profile updated successfully!</p>
		{/if}
		{#if form?.message}
			<p class="error-message">{form.message}</p>
		{/if}
	</form>

	<form method="post" action="?/changePassword" use:enhance class="profile-form">
		<div class="profile-section">
			<div class="section-header">
				<h2>Change Password</h2>
			</div>

			<div class="form-stack">
				<label class="form-field">
					<span class="form-label">Current Password</span>
					<input
						type="password"
						name="currentPassword"
						required
						placeholder="Enter current password"
						autocomplete="current-password"
					/>
				</label>

				<label class="form-field">
					<span class="form-label">New Password</span>
					<input
						type="password"
						name="newPassword"
						required
						minlength="6"
						placeholder="Enter new password (min 6 characters)"
						autocomplete="new-password"
					/>
				</label>

				<label class="form-field">
					<span class="form-label">Confirm New Password</span>
					<input
						type="password"
						name="confirmPassword"
						required
						minlength="6"
						placeholder="Confirm new password"
						autocomplete="new-password"
					/>
				</label>
			</div>
		</div>

		<div class="form-actions">
			<button type="submit" class="btn btn-primary">Change Password</button>
		</div>

		{#if form?.passwordSuccess}
			<p class="success-message">Password changed successfully!</p>
		{/if}
		{#if form?.passwordError}
			<p class="error-message">{form.passwordError}</p>
		{/if}
	</form>

	<div class="profile-section danger-zone">
		<div class="section-header">
			<h2>Session</h2>
		</div>
		<form method="post" action="?/logout" use:enhance>
			<button type="submit" class="btn btn-secondary">Logout</button>
		</form>
	</div>
</div>

<style>
	.profile-page {
		max-width: 100%;
	}

	.profile-page h1 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 2rem;
	}

	.profile-section {
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.section-header {
		margin-bottom: 1.25rem;
	}

	.section-header h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.account-info {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.info-label {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.info-value {
		font-size: 0.875rem;
		color: var(--color-text);
		font-weight: 500;
	}

	.profile-form {
		display: contents;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.form-stack {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.form-spacer {
		display: block;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.form-field input,
	.form-field select {
		width: 100%;
		padding: 0.75rem 1rem;
		font-size: 1rem;
		background-color: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text);
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.form-field input::placeholder {
		color: var(--color-text-muted);
	}

	.form-field input:focus,
	.form-field select:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px var(--color-primary-light);
	}

	.form-actions {
		margin-bottom: 1rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.75rem 1.5rem;
		font-size: 1rem;
		font-weight: 500;
		border-radius: var(--radius-md);
		border: none;
		cursor: pointer;
		text-decoration: none;
		transition: background-color 0.2s, transform 0.1s;
	}

	.btn:active {
		transform: scale(0.98);
	}

	.btn-primary {
		background-color: var(--color-primary);
		color: white;
	}

	.btn-primary:hover {
		background-color: var(--color-primary-hover);
	}

	.btn-secondary {
		background-color: var(--color-bg-secondary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	.btn-secondary:hover {
		background-color: var(--color-bg);
		border-color: var(--color-border-strong);
	}

	.success-message {
		padding: 1rem;
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
		border: 1px solid var(--color-success);
		color: var(--color-success);
		margin-bottom: 1.5rem;
	}

	.error-message {
		padding: 1rem;
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		background-color: color-mix(in srgb, var(--color-error) 15%, transparent);
		border: 1px solid var(--color-error);
		color: var(--color-error);
		margin-bottom: 1.5rem;
	}

	.danger-zone {
		border-color: var(--color-border);
	}

	@media (max-width: 600px) {
		.form-grid {
			grid-template-columns: 1fr;
		}

		.form-spacer {
			display: none;
		}

		.profile-section {
			padding: 1.25rem;
		}
	}
</style>
