<script>
    import '../../app.css';
    import { resolve } from '$app/paths';
    import logo from '$lib/assets/favicon.svg';
    let { children } = $props();

</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="public-layout">
    <div class="content-wrapper">
        <a href={resolve("/")} class="brand-logo">
            <img src={logo} alt="Magnamondo" />
        </a>
        {@render children()}
    </div>
</div>

<style>
    .public-layout {
        min-height: 100vh;
        background-color: var(--color-bg);
        color: var(--color-text);
        position: relative;
    }
    
    .brand-logo {
        display: block;
        width: 96px;
        height: 96px;
        margin-bottom: 2rem;
        transform: scaleX(-1);
    }

    .brand-logo img {
        width: 100%;
        height: 100%;
        display: block;
    }

    @media (max-width: 600px) {
        .brand-logo {
            width: 64px;
            height: 64px;
            margin-bottom: 1.5rem;
        }
    }

    .content-wrapper {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2rem 1rem;
    }

    /* Auth Card */
    :global(.auth-card) {
        width: 100%;
        max-width: 400px;
        background-color: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 2rem;
        box-shadow: var(--shadow-lg);
    }

    :global(.auth-header) {
        margin-bottom: 1.5rem;
        text-align: center;
    }

    :global(.auth-header h1) {
        font-size: 1.75rem;
        font-weight: 600;
        color: var(--color-text);
        margin: 0;
    }

    :global(.auth-header p) {
        font-size: 0.9rem;
        color: var(--color-text-muted);
        margin-top: 0.5rem;
    }

    /* Auth Form */
    :global(.auth-form) {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    :global(.auth-field) {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    :global(.auth-label-text) {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--color-text-secondary);
    }

    :global(.auth-field input) {
        width: 100%;
        padding: 0.75rem 1rem;
        font-size: 1rem;
        background-color: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text);
        transition: border-color 0.2s, box-shadow 0.2s;
    }

    :global(.auth-field input::placeholder) {
        color: var(--color-text-muted);
    }

    :global(.auth-field input:focus) {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-primary-light);
    }

    /* Auth Actions */
    :global(.auth-actions) {
        margin-top: 0.5rem;
    }

    :global(.auth-forgot-password) {
        text-align: right;
        margin-top: -0.5rem;
    }

    :global(.auth-forgot-link) {
        font-size: 0.875rem;
        color: var(--color-primary);
        text-decoration: none;
        transition: color 0.2s;
    }

    :global(.auth-forgot-link:hover) {
        color: var(--color-primary-hover);
        text-decoration: underline;
    }

    /* Buttons */
    :global(.btn) {
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

    :global(.btn:active) {
        transform: scale(0.98);
    }

    :global(.btn--primary) {
        width: 100%;
        background-color: var(--color-primary);
        color: white;
    }

    :global(.btn--primary:hover) {
        background-color: var(--color-primary-hover);
    }

    /* Messages */
    :global(.auth-message) {
        padding: 1rem;
        border-radius: var(--radius-md);
        margin-bottom: 1rem;
        font-size: 0.9rem;
    }

    :global(.auth-message.success) {
        background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
        border: 1px solid var(--color-success);
        color: var(--color-success);
    }

    :global(.auth-success-message) {
        padding: 1rem;
        border-radius: var(--radius-md);
        margin-top: 1rem;
        font-size: 0.9rem;
        background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
        border: 1px solid var(--color-success);
        color: var(--color-success);
    }

    :global(.auth-error-message) {
        padding: 1rem;
        border-radius: var(--radius-md);
        margin-top: 1rem;
        font-size: 0.9rem;
        background-color: color-mix(in srgb, var(--color-error) 15%, transparent);
        border: 1px solid var(--color-error);
        color: var(--color-error);
    }

    :global(.auth-success-message h3),
    :global(.auth-error-message h3) {
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
        font-weight: 600;
        color: inherit;
    }

    :global(.auth-success-message p),
    :global(.auth-error-message p) {
        margin: 0;
    }

    /* Footer Links */
    :global(.auth-register),
    :global(.auth-footer-link) {
        margin-top: 1.5rem;
        text-align: center;
        font-size: 0.9rem;
        color: var(--color-text-muted);
    }

    :global(.auth-register a),
    :global(.auth-footer-link a),
    :global(.register-link) {
        color: var(--color-primary);
        text-decoration: none;
        font-weight: 500;
        transition: color 0.2s;
    }

    :global(.auth-register a:hover),
    :global(.auth-footer-link a:hover),
    :global(.register-link:hover) {
        color: var(--color-primary-hover);
        text-decoration: underline;
    }

    @media (max-width: 480px) {
        :global(.auth-card) {
            padding: 1.5rem;
            border-radius: var(--radius-md);
        }

        :global(.auth-header h1) {
            font-size: 1.5rem;
        }
    }
</style>
