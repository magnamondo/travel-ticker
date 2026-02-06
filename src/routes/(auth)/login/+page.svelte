<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	
	let { form } = $props();
	let emailInput: HTMLInputElement | undefined;

	const targetBinary = '01110111011000010110011001100110011001010110111001110011011000110110100001110010011000010110111001101011';

	function textToBinary(text: string): string {
		return text.split('').map(char => char.charCodeAt(0).toString(2).padStart(8, '0')).join('');
	}

	function handleEmailInput(event: Event) {
		const input = event.target as HTMLInputElement;
		if (textToBinary(input.value) === targetBinary) {
			document.dispatchEvent(new Event('toggle-be'));
		}
	}

	onMount(() => {
		emailInput?.focus();
	});
</script>

<svelte:head>
	<title>Login / Magnamondo</title>
</svelte:head>

<div class="auth-card">
	<div class="auth-header">
		<h1>Login</h1>
	</div>

	{#if $page.url.searchParams.get('verificationSent') === 'true'}
		<div class="auth-message success">
			<p>Registration successful! Please check your email to verify your account before logging in.</p>
		</div>
	{/if}

	<form method="post" action="?/login" use:enhance class="auth-form">
		{#if $page.url.searchParams.has('redirectTo')}
			<input type="hidden" name="redirectTo" value={$page.url.searchParams.get('redirectTo')} />
		{/if}
		<label class="auth-field">
			<span class="auth-label-text">Email</span>
			<input
				bind:this={emailInput}
				name="email"
				type="email"
				required
				placeholder="you@example.com"
				oninput={handleEmailInput}
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
		
		<div class="auth-forgot-password">
			<a href={resolve("/forgot-password")} class="auth-forgot-link">Forgot Password?</a>
		</div>

		<div class="auth-actions">
			<button class="btn btn--primary">Login</button>
		</div>

		<div class="auth-register">
			Don't have an account? <a href={resolve("/register")} class="register-link">Register</a>
		</div>
	</form>
	
	{#if form?.message}
		<p class="auth-error-message">{form.message}</p>
	{/if}
</div>
