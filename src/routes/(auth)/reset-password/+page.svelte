<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let { form } = $props();
	let passwordInput: HTMLInputElement | undefined = $state();

	onMount(() => {
		passwordInput?.focus();
	});
</script>

<svelte:head>
	<title>Reset Password / Magnamondo</title>
</svelte:head>

<div class="auth-card">
	<div class="auth-header">
		<h1>Set New Password</h1>
	</div>

	{#if !form?.success}
		<form method="post" use:enhance class="auth-form">
			<input type="hidden" name="token" value={$page.url.searchParams.get('token')} />

			<label class="auth-field">
				<span class="auth-label-text">New Password</span>
				<input bind:this={passwordInput} id="password" type="password" name="password" required placeholder="••••••••" />
			</label>

			<div class="auth-actions">
				<button class="btn btn--primary">Reset Password</button>
			</div>
		</form>
	{:else}
		<div class="auth-success-message">
			<p>{form.message}</p>
		</div>
		<div class="auth-actions">
			<a href={resolve('/login')} class="btn btn--primary">Go to Login</a>
		</div>
	{/if}

	{#if form?.message && !form.success}
		<p class="auth-error-message">{form.message}</p>
	{/if}
</div>
