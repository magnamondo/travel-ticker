<script lang="ts">
	import logo from '$lib/assets/favicon.svg';
	import { resolve } from '$app/paths';

	let { data } = $props();

	function formatLatest(value: string | Date | null): string | null {
		if (!value) return null;
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return null;
		return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
	}

	function plural(n: number, one: string, many: string): string {
		return `${n} ${n === 1 ? one : many}`;
	}
</script>

<svelte:head>
	<title>Travel Ticker | Magnamondo</title>
	<meta name="description" content="Dirt, dust and detours — travel journals from Magnamondo." />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Travel Ticker | Magnamondo" />
	<meta
		property="og:description"
		content="Dirt, dust and detours — travel journals from Magnamondo."
	/>
	<meta property="og:image" content="{data.origin}/logo.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:url" content={data.origin} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Travel Ticker | Magnamondo" />
	<meta
		name="twitter:description"
		content="Dirt, dust and detours — travel journals from Magnamondo."
	/>
	<meta name="twitter:image" content="{data.origin}/logo.png" />
</svelte:head>

<section class="index-section">
	<header class="index-header">
		<img src={logo} alt="Magnamondo" class="logo" />
		<h1 class="index-title">Travel Ticker</h1>
		<p class="index-subtitle">Dirt, dust and detours</p>
	</header>

	{#if data.tickers.length === 0}
		<div class="empty-state">
			<span class="empty-icon">🧭</span>
			<h2>No tickers yet</h2>
			<p>
				{#if data.user?.isAdmin}
					Create your first ticker in the <a href={resolve('/admin/tickers')}>admin area</a> to start
					a timeline.
				{:else}
					Nothing has been published yet. Check back soon.
				{/if}
			</p>
		</div>
	{:else}
		<ul class="ticker-grid">
			{#each data.tickers as ticker (ticker.id)}
				{@const latest = formatLatest(ticker.latestEntryAt)}
				<li>
					<a class="ticker-card" href={resolve(`/t/${ticker.slug}`)}>
						<div class="cover">
							{#if ticker.coverImage}
								<img src={ticker.coverImage} alt="" loading="lazy" />
							{:else if ticker.previewImages.length > 0}
								<div class="mosaic" data-count={Math.min(ticker.previewImages.length, 4)}>
									{#each ticker.previewImages.slice(0, 4) as src (src)}
										<img {src} alt="" loading="lazy" />
									{/each}
								</div>
							{:else}
								<div class="cover-placeholder" aria-hidden="true"></div>
							{/if}

							<!-- Scrim keeps the overlaid title legible over any photo -->
							<div class="scrim"></div>

							{#if !ticker.published}
								<span class="draft-badge" title="Draft - not visible to others">Draft</span>
							{/if}

							<div class="cover-caption">
								<h2 class="ticker-name">{ticker.name}</h2>
								{#if ticker.originLabel && ticker.destinationLabel}
									<p class="ticker-route">
										<span>{ticker.originLabel}</span>
										<span class="route-arrow" aria-hidden="true"></span>
										<span>{ticker.destinationLabel}</span>
									</p>
								{:else if ticker.tagline}
									<p class="ticker-route">{ticker.tagline}</p>
								{/if}
							</div>
						</div>

						<div class="ticker-body">
							{#if ticker.description}
								<p class="ticker-description">{ticker.description}</p>
							{/if}

							<div class="ticker-stats">
								<span class="stat strong">{plural(ticker.entryCount, 'entry', 'entries')}</span>
								<span class="stat">{plural(ticker.segmentCount, 'segment', 'segments')}</span>
								{#if latest}
									<span class="stat updated">Updated {latest}</span>
								{/if}
							</div>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.index-section {
		max-width: 1120px;
		margin: 0 auto;
		padding: 3rem 1.25rem 5rem;
	}

	.index-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		margin-bottom: 2.75rem;
	}

	/* The global reset sets img { display: block }, so centering needs the flex
	   parent above rather than text-align. */
	.logo {
		width: 72px;
		height: 72px;
	}

	.index-title {
		margin: 0rem 0 0;
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--color-text);
	}

	.index-subtitle {
		margin: 0.4rem 0 0;
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.ticker-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		align-items: start;
		gap: 1.5rem;
	}

	/* With only one or two tickers, auto-fit would stretch them across the full
	   width; cap the track so cards keep their proportions and stay centred. */
	.ticker-grid:has(li:last-child:nth-child(-n + 2)) {
		grid-template-columns: repeat(auto-fit, minmax(300px, 420px));
		justify-content: center;
	}

	.ticker-card {
		display: flex;
		flex-direction: column;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		text-decoration: none;
		color: inherit;
		box-shadow: var(--shadow-sm);
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			border-color 0.18s ease;
	}

	.ticker-card:hover,
	.ticker-card:focus-visible {
		transform: translateY(-3px);
		box-shadow: var(--shadow-lg);
		border-color: var(--color-border-strong);
	}

	.cover {
		position: relative;
		aspect-ratio: 3 / 2;
		background: var(--color-bg);
		overflow: hidden;
	}

	.cover > img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.mosaic {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-auto-rows: 1fr;
		gap: 2px;
		width: 100%;
		height: 100%;
	}

	.mosaic[data-count='1'] {
		grid-template-columns: 1fr;
	}

	/* Three previews would leave a hole, so the first one spans both rows. */
	.mosaic[data-count='3'] img:first-child {
		grid-row: span 2;
	}

	.mosaic img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.cover-placeholder {
		width: 100%;
		height: 100%;
		background:
			radial-gradient(circle at 30% 20%, var(--color-primary-light), transparent 60%),
			linear-gradient(140deg, var(--color-bg-secondary), var(--color-bg));
	}

	.scrim {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			to top,
			rgba(0, 0, 0, 0.82) 0%,
			rgba(0, 0, 0, 0.45) 32%,
			rgba(0, 0, 0, 0) 62%
		);
	}

	.cover-caption {
		position: absolute;
		inset: auto 0 0 0;
		padding: 1rem 1.15rem 0.95rem;
	}

	.ticker-name {
		margin: 0;
		font-size: 1.3rem;
		line-height: 1.25;
		color: #fff;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	}

	.ticker-route {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
		margin: 0.35rem 0 0;
		font-size: 0.8rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: rgba(255, 255, 255, 0.88);
	}

	.route-arrow {
		width: 34px;
		height: 1px;
		background: currentColor;
		position: relative;
		opacity: 0.75;
	}

	.route-arrow::after {
		content: '';
		position: absolute;
		right: 0;
		top: -2.5px;
		border-left: 5px solid currentColor;
		border-top: 3px solid transparent;
		border-bottom: 3px solid transparent;
	}

	.draft-badge {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		background: var(--color-accent);
		color: var(--color-text-on-accent);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.2rem 0.55rem;
		border-radius: var(--radius-full);
	}

	.ticker-body {
		display: flex;
		flex-direction: column;
		flex: 1;
		padding: 0.95rem 1.15rem 1rem;
	}

	.ticker-description {
		margin: 0 0 0.9rem;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--color-text-secondary);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.ticker-stats {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: auto;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.stat + .stat::before {
		content: '\00b7';
		margin-right: 0.5rem;
		opacity: 0.55;
	}

	.stat.strong {
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 1rem;
		color: var(--color-text-secondary);
	}

	.empty-icon {
		font-size: 3rem;
		display: block;
		margin-bottom: 1rem;
		opacity: 0.5;
	}

	.empty-state h2 {
		margin: 0 0 0.5rem;
		color: var(--color-text);
	}

	.empty-state p {
		margin: 0;
	}

	@media (max-width: 640px) {
		.index-section {
			padding: 2rem 1rem 3.5rem;
		}

		.ticker-grid,
		.ticker-grid:has(li:last-child:nth-child(-n + 2)) {
			grid-template-columns: 1fr;
			justify-content: stretch;
		}
	}
</style>
