<script lang="ts">
	// Values are baked in at build time (see `define` in vite.config.ts), so this
	// reports the build that is actually running, not the source tree.
	const version = __APP_VERSION__;
	const buildTime = __APP_BUILD_TIME__;
	const gitSha = __APP_GIT_SHA__;

	const built = new Date(buildTime);

	// Formatted with an explicit locale and UTC so the server and the client
	// produce the same string and hydration doesn't mismatch. The copyright year
	// comes from the build too, rather than `new Date()`, for the same reason.
	const buildDate = built.toLocaleDateString('en-GB', {
		timeZone: 'UTC',
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	});

	const fullTimestamp = built.toLocaleString('en-GB', {
		timeZone: 'UTC',
		dateStyle: 'full',
		timeStyle: 'short'
	});

	const year = built.getUTCFullYear();
</script>

<footer class="site-footer">
	<p class="copyright">
		&copy; {year} Magnamondo
	</p>
	<p class="build-info">
		<span class="version">v{version}</span>
		{#if gitSha}
			<span class="sep" aria-hidden="true">·</span>
			<span class="sha">{gitSha}</span>
		{/if}
		<span class="sep" aria-hidden="true">·</span>
		<span>
			built <time datetime={buildTime} title="{fullTimestamp} UTC">{buildDate}</time>
		</span>
	</p>
</footer>

<style>
	.site-footer {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 2rem 1rem 2.5rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	.copyright {
		margin: 0;
		font-size: 0.78rem;
	}

	.build-info {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.7rem;
		opacity: 0.65;
	}

	.version {
		font-weight: 600;
	}

	.version,
	.sha {
		font-family: var(--font-mono);
	}

	.sep {
		opacity: 0.6;
	}

	time {
		border-bottom: 1px dotted currentColor;
		cursor: help;
	}
</style>
