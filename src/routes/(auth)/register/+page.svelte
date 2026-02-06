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
	<title>Register / Magnamondo</title>
</svelte:head>

<div class="auth-card">
	<div class="auth-header">
		<h1>Register</h1>
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
		<label class="auth-field">
			<span class="auth-label-text">Password</span>
			<input
				type="password"
				name="password"
				required
				placeholder="••••••••"
			/>
		</label>

		<div class="auth-actions">
			<button class="btn btn--primary">Create Account</button>
		</div>
		
		<div class="auth-footer-link">
			Already have an account? <a href={resolve("/login")}>Login</a>
		</div>
	</form>
	
	{#if form?.message}
		<p class="auth-error-message">{form.message}</p>
	{/if}
</div>
