<script lang="ts">
	import { enhance } from '$app/forms';
	import { SvelteMap } from 'svelte/reactivity';
	import Reactions from '$lib/components/Reactions.svelte';
	import ImageLightbox from '$lib/components/ImageLightbox.svelte';
	import { getMapsUrl } from '$lib/maps';
	import { toasts } from '$lib/stores/toast.svelte';

	type ReactionCount = {
		emoji: string;
		count: number;
		userReacted: boolean;
	};

	let { data, form } = $props();

	let content = $state('');
	let submitting = $state(false);
	let commentReactionsOverrides = new SvelteMap<string, ReactionCount[]>();

	// Get reactions for a comment - use override if set, otherwise use server data
	function getCommentReactions(commentId: string): ReactionCount[] {
		if (commentReactionsOverrides.has(commentId)) {
			return commentReactionsOverrides.get(commentId)!;
		}
		const comment = data.comments.find(c => c.id === commentId);
		if (comment?.reactions) {
			return formatReactions(comment.reactions, data.user?.id);
		}
		return [];
	}

	// Reactions state - can be null to indicate "use server data", or overridden after user action
	let localMilestoneReactions = $state<ReactionCount[] | null>(null);
	
	let milestoneReactions = $derived(
		localMilestoneReactions ?? formatReactions(data.milestone.reactions, data.user?.id)
	);

	function formatReactions(grouped: Record<string, { count: number; userReacted?: boolean; userIds?: string[] }>, userId?: string): ReactionCount[] {
		return Object.entries(grouped).map(([emoji, r]) => ({
			emoji,
			count: r.count,
			userReacted: r.userReacted ?? (userId && r.userIds ? r.userIds.includes(userId) : false)
		}));
	}

	// Lightbox state
	let lightboxOpen = $state(false);
	let lightboxIndex = $state(0);

	function openLightbox(index: number) {
		lightboxIndex = index;
		lightboxOpen = true;
	}

	function closeLightbox() {
		lightboxOpen = false;
	}

	$effect(() => {
		if (form?.content) content = form.content;
	});

	async function handleMilestoneReaction(emoji: string) {
		const res = await fetch('/api/reactions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetType: 'milestone', targetId: data.milestone.id, emoji })
		});
		if (res.ok) {
			const { reactions } = await res.json();
			localMilestoneReactions = formatReactionsFromApi(reactions, data.user?.id);
		} else {
			toasts.error('Failed to add reaction');
		}
	}

	async function handleCommentReaction(commentId: string, emoji: string) {
		const res = await fetch('/api/reactions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetType: 'comment', targetId: commentId, emoji })
		});
		if (res.ok) {
			const { reactions } = await res.json();
			commentReactionsOverrides.set(commentId, formatReactionsFromApi(reactions, data.user?.id));
		} else {
			toasts.error('Failed to add reaction');
		}
	}

	function formatReactionsFromApi(grouped: Record<string, { count: number; userIds: string[] }>, userId?: string): ReactionCount[] {
		return Object.entries(grouped).map(([emoji, r]) => ({
			emoji,
			count: r.count,
			userReacted: userId ? r.userIds.includes(userId) : false
		}));
	}
</script>

<svelte:head>
	<title>{data.milestone.title} | Toulouse - Tsévié | Travel Ticker | Magnamondo</title>
</svelte:head>

<div class="entry-page">
	<a href="/" class="back-link">
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M19 12H5M12 19l-7-7 7-7"/>
		</svg>
		Back to timeline
	</a>

	<article class="entry">
		<header class="entry-header">
			<div class="segment-badge">
				<span class="segment-icon">{data.milestone.segmentIcon}</span>
				<span class="segment-name">{data.milestone.segment}</span>
			</div>
			<div class="date">
				<span class="month">{data.milestone.date.month}</span>
				<span class="day">{data.milestone.date.day}</span>
				<span class="year">{data.milestone.date.year}</span>
			</div>
		</header>

		<div class="entry-content">
			{#if data.milestone.avatar}
				<img src={data.milestone.avatar} alt="" class="avatar" />
			{/if}
			<h1>{data.milestone.title}</h1>
			<p class="description">{data.milestone.description}</p>

			{#if data.milestone.images?.length}
				<div class="images">
					{#each data.milestone.images as image, i (i)}
						<button
							class="image-button"
							onclick={() => openLightbox(i)}
							aria-label="View image {i + 1} fullscreen"
						>
							<img src={image} alt="" class="entry-image" />
						</button>
					{/each}
				</div>
			{/if}

			{#if data.milestone.meta && data.milestone.meta.length > 0}
				<div class="meta">
					{#each data.milestone.meta as metaItem (metaItem.type + metaItem.value)}
						{#if metaItem.type === 'coordinates'}
							<a href={getMapsUrl(metaItem.value)} target="_blank" rel="noopener" class="meta-item meta-link">
								<span class="meta-icon">📍</span>
								<span>{metaItem.label || 'View on map'}</span>
							</a>
						{:else if metaItem.type === 'link'}
							<a href={metaItem.value} target="_blank" rel="noopener" class="meta-item meta-link">
								<span class="meta-icon">{metaItem.icon || '🔗'}</span>
								<span>{metaItem.label || 'Link'}</span>
							</a>
						{:else if metaItem.type === 'icon'}
							<div class="meta-item">
								<span class="meta-icon">{metaItem.icon || metaItem.value}</span>
								{#if metaItem.label}
									<span>{metaItem.label}</span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}

			<div class="entry-reactions">
				<Reactions
					reactions={milestoneReactions}
					targetType="milestone"
					targetId={data.milestone.id}
					isLoggedIn={!!data.user}
					canReact={data.user?.canReact ?? false}
					onReact={handleMilestoneReaction}
				/>
			</div>
		</div>
	</article>

	<section class="comments-section">
		<h2>
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
			</svg>
			Comments ({data.comments.length})
		</h2>

		{#if data.user}
			{#if data.user.canComment}
				<form
					method="POST"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							await update();
							submitting = false;
							if (form?.success) {
								content = '';
							}
						};
					}}
					class="comment-form"
				>
					{#if form?.error}
						<div class="error-message">{form.error}</div>
					{/if}
					{#if form?.success}
						<div class="success-message">Comment added!</div>
					{/if}
					<div class="posting-as">
						Posting as <strong>{data.user.displayName}</strong>
					</div>
					<div class="form-row">
						<label for="content" class="visually-hidden">Your comment</label>
						<textarea
							id="content"
							name="content"
							placeholder="Write a comment..."
							rows="3"
							bind:value={content}
							required
						></textarea>
					</div>
					<button type="submit" disabled={submitting}>
						{#if submitting}
							Posting...
						{:else}
							Post Comment
						{/if}
					</button>
				</form>
			{:else}
				<div class="permission-notice">
					<p>You don't have permission to post comments.</p>
				</div>
			{/if}
		{:else}
			<div class="login-prompt">
				<p>Please <a href="/login?redirectTo=/entry/{data.milestone.id}">log in</a> to leave a comment.</p>
			</div>
		{/if}

		{#if data.comments.length > 0}
			<ul class="comments-list">
				{#each data.comments as comment (comment.id)}
					<li class="comment">
						<div class="comment-header">
							<span class="comment-author">{comment.authorName}</span>
							<time class="comment-date" datetime={comment.createdAt}>
								{new Date(comment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
							</time>
						</div>
						<p class="comment-content">{comment.content}</p>
						<div class="comment-reactions">
							<Reactions
								reactions={getCommentReactions(comment.id)}
								targetType="comment"
								targetId={comment.id}
								isLoggedIn={!!data.user}
								canReact={data.user?.canReact ?? false}
								onReact={(emoji) => handleCommentReaction(comment.id, emoji)}
							/>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="no-comments">No comments yet. Be the first to comment!</p>
		{/if}
	</section>
</div>

{#if data.milestone.images?.length}
	<ImageLightbox
		images={data.milestone.images}
		currentIndex={lightboxIndex}
		open={lightboxOpen}
		onclose={closeLightbox}
	/>
{/if}

<style>
	.entry-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: 1.5rem;
		transition: color 0.2s;
	}

	.back-link:hover {
		color: var(--color-primary);
	}

	.entry {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-lg);
		overflow: hidden;
		box-shadow: var(--shadow-md);
		margin-bottom: 2rem;
	}

	.entry-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.5rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.segment-badge {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.segment-icon {
		font-size: 1.25rem;
	}

	.segment-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.date {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.date .day {
		font-weight: 600;
		font-size: 1rem;
		color: var(--color-text);
	}

	.entry-content {
		padding: 1.5rem;
	}

	.avatar {
		width: 64px;
		height: 64px;
		border-radius: var(--radius-full);
		object-fit: cover;
		margin-bottom: 1rem;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
		margin: 0 0 0.75rem 0;
	}

	.description {
		font-size: 1rem;
		color: var(--color-text-secondary);
		line-height: 1.6;
		margin: 0 0 1.5rem 0;
	}

	.images {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.image-button {
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: transform 0.2s, box-shadow 0.2s;
	}

	.image-button:hover {
		transform: scale(1.02);
		box-shadow: var(--shadow-lg);
	}

	.entry-image {
		width: 100%;
		border-radius: var(--radius-md);
		object-fit: cover;
		aspect-ratio: 4/3;
		display: block;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.meta-link {
		text-decoration: none;
		color: var(--color-primary);
	}

	.meta-link:hover {
		text-decoration: underline;
	}

	.comments-section {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		box-shadow: var(--shadow-sm);
	}

	.comments-section h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 1.5rem 0;
	}

	.comment-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1.5rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.form-row textarea {
		width: 100%;
		padding: 0.75rem 1rem;
		font-size: 0.875rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		transition: border-color 0.2s;
	}

	.form-row textarea:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.form-row textarea {
		resize: vertical;
		min-height: 80px;
	}

	.posting-as {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.posting-as strong {
		color: var(--color-text);
	}

	.login-prompt {
		padding: 1.5rem;
		text-align: center;
		background: var(--color-bg);
		border-radius: var(--radius-md);
		margin-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.login-prompt p {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.login-prompt a {
		color: var(--color-primary);
		font-weight: 600;
	}

	button[type="submit"] {
		align-self: flex-start;
		padding: 0.75rem 1.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: white;
		background: var(--color-primary);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background-color 0.2s;
	}

	button[type="submit"]:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	button[type="submit"]:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.error-message {
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
		color: var(--color-error);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
	}

	.success-message {
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-success);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
	}

	.permission-notice {
		padding: 1rem;
		background: var(--color-bg);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		font-size: 0.875rem;
		text-align: center;
	}

	.comments-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.comment {
		padding: 1rem;
		background: var(--color-bg);
		border-radius: var(--radius-md);
	}

	.comment-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.comment-author {
		font-weight: 600;
		color: var(--color-text);
	}

	.comment-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.comment-content {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.comment-reactions {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.entry-reactions {
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--color-border);
	}

	.no-comments {
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		padding: 2rem 0;
	}

	@media (max-width: 640px) {
		.entry-page {
			padding: 1rem;
		}

		.entry-header {
			padding: 1rem;
		}

		.entry-content {
			padding: 1rem;
		}

		h1 {
			font-size: 1.25rem;
		}

		.images {
			grid-template-columns: 1fr;
		}
	}
</style>
