<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	
	let { form } = $props();
	let emailInput: HTMLInputElement | undefined;

	onMount(() => {
		emailInput?.focus();
	});
</script>

<svelte:head>
	<title>Forgot Password / Magnamondo</title>
</svelte:head>

<div class="auth-card">
	<div class="auth-header">
		<h1>Reset Password</h1>
		<p>Enter your email to receive instructions</p>
	</div>

	<form method="post" use:enhance class="auth-form">
		<label class="auth-field">
			<span class="auth-label-text">Email</span>
			<input
				bind:this={emailInput}
				name="email"
				type="email"
				required
				placeholder="you@example.com"
			/>
		</label>

		<div class="auth-actions">
			<button class="btn btn--primary">Send Reset Link</button>
		</div>
	</form>
	
	{#if form?.message}
		{#if form.success}
			<p class="auth-success-message">{form.message}</p>
		{:else}
			<p class="auth-error-message">{form.message}</p>
		{/if}
	{/if}
    
    <div class="auth-footer-link">
        <a href={resolve("/login")}>Back to Login</a>
    </div>
</div>
