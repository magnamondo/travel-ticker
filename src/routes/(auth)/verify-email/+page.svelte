<script>
    import { resolve } from '$app/paths';
	let { data } = $props();
</script>

<svelte:head>
	<title>Email Verification / Magnamondo</title>
</svelte:head>

<div class="auth-card">
    <div class="auth-header">
        <h1>Email Verification</h1>
    </div>

    {#if data.success}
        <div class="auth-success-message">
            <h3>Account unlocked!</h3>
            <p>{data.message}</p>
        </div>
    {:else}
        <div class="auth-error-message">
            <h3>Error</h3>
            <p>{data.message}</p>
        </div>
    {/if}

    <div class="auth-actions">
        <a href={resolve("/login")} class="btn btn--primary">Go to Login</a>
    </div>
</div>
