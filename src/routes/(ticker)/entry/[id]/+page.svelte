<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import Reactions from '$lib/components/Reactions.svelte';
	import ImageLightbox from '$lib/components/ImageLightbox.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
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
	let commentsListEl: HTMLUListElement | null = $state(null);
	let highlightedCommentId = $state<string | null>(null);

	// Edit/delete state
	let editingCommentId = $state<string | null>(null);
	let editContent = $state('');
	let editSubmitting = $state(false);
	let deleteSubmitting = $state<string | null>(null);
	let hideSubmitting = $state<string | null>(null);
	
	// Track deleted comments locally (to hide them immediately)
	let deletedCommentIds = $state<Set<string>>(new Set());

	// Delete confirmation dialog state
	let deleteDialogOpen = $state(false);
	let pendingDeleteCommentId = $state<string | null>(null);

	const EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

	function isWithinEditWindow(createdAt: string): boolean {
		return Date.now() - new Date(createdAt).getTime() < EDIT_WINDOW_MS;
	}

	function canEditComment(comment: { userId: string | null; createdAt: string }): boolean {
		if (!data.user) return false;
		return comment.userId === data.user.id && isWithinEditWindow(comment.createdAt);
	}

	function canDeleteComment(comment: { userId: string | null; createdAt: string }): boolean {
		if (!data.user) return false;
		// Admins can delete any comment, owners can delete within 5 min
		if (data.user.isAdmin) return true;
		return comment.userId === data.user.id && isWithinEditWindow(comment.createdAt);
	}

	function startEditing(comment: { id: string; content: string }) {
		editingCommentId = comment.id;
		editContent = comment.content;
	}

	function cancelEditing() {
		editingCommentId = null;
		editContent = '';
	}

	async function saveEdit(commentId: string) {
		if (!editContent.trim()) return;
		editSubmitting = true;
		try {
			const res = await fetch(`/api/comments/${commentId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: editContent })
			});
			if (res.ok) {
				toasts.success('Comment updated');
				editingCommentId = null;
				editContent = '';
				await invalidateAll(); // refresh data from server
			} else {
				const err = await res.json();
				toasts.error(err.message || 'Failed to update comment');
			}
		} catch {
			toasts.error('Failed to update comment');
		} finally {
			editSubmitting = false;
		}
	}

	function requestDeleteComment(commentId: string) {
		pendingDeleteCommentId = commentId;
		deleteDialogOpen = true;
	}

	function cancelDelete() {
		deleteDialogOpen = false;
		pendingDeleteCommentId = null;
	}

	async function confirmDelete() {
		if (!pendingDeleteCommentId) return;
		deleteDialogOpen = false;
		const commentId = pendingDeleteCommentId;
		pendingDeleteCommentId = null;
		
		deleteSubmitting = commentId;
		try {
			const res = await fetch(`/api/comments/${commentId}`, { method: 'DELETE' });
			if (res.ok) {
				toasts.success('Comment deleted');
				deletedCommentIds.add(commentId);
				deletedCommentIds = deletedCommentIds; // trigger reactivity
				await invalidateAll(); // refresh data from server
			} else {
				const err = await res.json();
				toasts.error(err.message || 'Failed to delete comment');
			}
		} catch {
			toasts.error('Failed to delete comment');
		} finally {
			deleteSubmitting = null;
		}
	}

	async function toggleHideComment(commentId: string, currentlyHidden: boolean) {
		hideSubmitting = commentId;
		try {
			const res = await fetch(`/api/comments/${commentId}/hide`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ hide: !currentlyHidden })
			});
			if (res.ok) {
				toasts.success(currentlyHidden ? 'Comment unhidden' : 'Comment hidden');
				await invalidateAll(); // refresh data from server
			} else {
				const err = await res.json();
				toasts.error(err.message || 'Failed to update comment');
			}
		} catch {
			toasts.error('Failed to update comment');
		} finally {
			hideSubmitting = null;
		}
	}

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
			const formatted = formatReactionsFromApi(reactions, data.user?.id);
			localMilestoneReactions = formatted;
			const userReacted = formatted.find(r => r.emoji === emoji)?.userReacted ?? false;
			toasts.success(`${emoji} ${userReacted ? 'added' : 'removed'}`);
		} else {
			toasts.error('Failed to update reaction');
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
			const formatted = formatReactionsFromApi(reactions, data.user?.id);
			commentReactionsOverrides.set(commentId, formatted);
			const userReacted = formatted.find(r => r.emoji === emoji)?.userReacted ?? false;
			toasts.success(`${emoji} ${userReacted ? 'added' : 'removed'}`);
		} else {
			toasts.error('Failed to update reaction');
		}
	}

	function formatReactionsFromApi(grouped: Record<string, { count: number; userIds: string[] }>, userId?: string): ReactionCount[] {
		return Object.entries(grouped).map(([emoji, r]) => ({
			emoji,
			count: r.count,
			userReacted: userId ? r.userIds.includes(userId) : false
		}));
	}

	// Combine images and videos into a single media array for lightbox
	type MediaItem = { type: 'image' | 'video'; url: string; thumbnailUrl?: string };
	const mediaItems = $derived<MediaItem[]>([
		...(data.milestone.images ?? []).map((url: string) => ({ type: 'image' as const, url })),
		...(data.milestone.videos ?? []).map((v) => ({
			type: 'video' as const,
			url: v.url,
			thumbnailUrl: v.thumbnailUrl ?? undefined
		}))
	]);

	// Compute absolute OG image URL
	const ogImageUrl = $derived.by(() => {
		const imageUrl = data.milestone.images?.[0];
		if (!imageUrl) return data.origin + '/logo.jpg';
		return imageUrl.startsWith('/') ? data.origin + imageUrl : imageUrl;
	});
</script>

<svelte:head>
	<title>{data.milestone.title} | Toulouse - Lomé | Travel Ticker | Magnamondo</title>
	<meta property="og:type" content="article">
	<meta property="og:title" content="{data.milestone.title} | Travel Ticker">
	<meta property="og:description" content={data.milestone.description?.slice(0, 160) ?? 'A moment from our journey'}>
	<meta property="og:image" content={ogImageUrl}>
	<meta property="og:image:width" content="1200">
	<meta property="og:image:height" content="630">
	<meta property="og:url" content="{data.origin}/entry/{data.milestone.id}">
	<meta name="twitter:card" content="summary_large_image">
	<meta name="twitter:title" content="{data.milestone.title} | Travel Ticker">
	<meta name="twitter:description" content={data.milestone.description?.slice(0, 160) ?? 'A moment from our journey'}>
	<meta name="twitter:image" content={ogImageUrl}>
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
			<p class="description">{@html (data.milestone.description ?? '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/\n/g, '<br>')}</p>

			{#if mediaItems.length > 0}
				<div class="media-grid">
					{#each mediaItems as item, i (i)}
						<button
							class="media-button"
							onclick={() => openLightbox(i)}
							aria-label="View {item.type} {i + 1} fullscreen"
						>
							{#if item.type === 'video'}
								<div class="video-thumbnail">
									{#if item.thumbnailUrl}
										<img src={item.thumbnailUrl} alt="" class="entry-media" />
									{:else}
										<div class="video-placeholder"></div>
									{/if}
									<div class="play-icon">
										<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white">
											<path d="M8 5v14l11-7z"/>
										</svg>
									</div>
								</div>
							{:else}
								<img src={item.url} alt="" class="entry-media" />
							{/if}
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
						if (submitting) return () => {}; // Prevent double submission
						submitting = true;
						return async ({ update, result }) => {
							await update();
							if (result.type === 'success') {
								content = '';
								toasts.success('Comment added!');
								// Scroll to the newest comment (by date) and highlight it
								setTimeout(() => {
									if (!data.comments.length) return;
									// Find the newest comment
									const newest = data.comments.reduce((a, b) => 
										new Date(a.createdAt) > new Date(b.createdAt) ? a : b
									);
									highlightedCommentId = newest.id;
									const commentEl = commentsListEl?.querySelector(`[data-comment-id="${newest.id}"]`);
									commentEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
									// Remove highlight after animation
									setTimeout(() => {
										highlightedCommentId = null;
									}, 4000);
								}, 100);
								// Keep submit disabled briefly to prevent rapid resubmits
								setTimeout(() => {
									submitting = false;
								}, 1000);
							} else {
								submitting = false;
								if (result.type === 'failure') {
									const errorMsg = (result.data as { error?: string })?.error ?? 'Failed to add comment';
									toasts.error(errorMsg);
								}
							}
						};
					}}
					class="comment-form"
				>
					<div class="posting-as">
						Posting as <strong>{data.userDisplayName}</strong>
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
							disabled={submitting}
						></textarea>
					</div>
					<button type="submit" disabled={submitting || !content.trim()}>
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
			<ul class="comments-list" bind:this={commentsListEl}>
				{#each data.comments.filter(c => !deletedCommentIds.has(c.id)) as comment (comment.id)}
					<li 
						class="comment" 
						class:comment-highlight={highlightedCommentId === comment.id} 
						class:comment-hidden={comment.isHidden}
						data-comment-id={comment.id}
					>
						<div class="comment-header">
							<div class="comment-meta">
								<span class="comment-author">{comment.authorName}</span>
								<time class="comment-date" datetime={comment.createdAt}>
									{new Date(comment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
								</time>
								{#if comment.updatedAt}
									<span class="comment-edited" title="Edited {new Date(comment.updatedAt).toLocaleString()}">(edited)</span>
								{/if}
								{#if comment.isHidden && data.user?.isAdmin}
									<span class="comment-hidden-badge">Hidden</span>
								{:else if comment.isHidden && comment.userId === data.user?.id}
									<span class="comment-hidden-icon" title="This comment is hidden from other users">
										<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
									</span>
								{/if}
							</div>
							<div class="comment-actions">
								{#if canEditComment(comment)}
									<button 
										type="button" 
										class="action-btn edit-btn" 
										onclick={() => startEditing(comment)}
										title="Edit comment"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
									</button>
								{/if}
								{#if canDeleteComment(comment)}
									<button 
										type="button" 
										class="action-btn delete-btn" 
										onclick={() => requestDeleteComment(comment.id)}
										disabled={deleteSubmitting === comment.id}
										title="Delete comment"
									>
										{#if deleteSubmitting === comment.id}
											<span class="spinner"></span>
										{:else}
											<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
										{/if}
									</button>
								{/if}
								{#if data.user?.isAdmin}
									<button 
										type="button" 
										class="action-btn hide-btn" 
										onclick={() => toggleHideComment(comment.id, comment.isHidden)}
										disabled={hideSubmitting === comment.id}
										title={comment.isHidden ? 'Unhide comment' : 'Hide comment'}
									>
										{#if hideSubmitting === comment.id}
											<span class="spinner"></span>
										{:else if comment.isHidden}
											<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
										{:else}
											<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
										{/if}
									</button>
								{/if}
							</div>
						</div>
						{#if editingCommentId === comment.id}
							<div class="edit-form">
								<textarea
									bind:value={editContent}
									rows="3"
									placeholder="Edit your comment..."
								></textarea>
								<div class="edit-actions">
									<button 
										type="button" 
										class="btn-secondary" 
										onclick={cancelEditing}
										disabled={editSubmitting}
									>
										Cancel
									</button>
									<button 
										type="button" 
										class="btn-primary" 
										onclick={() => saveEdit(comment.id)}
										disabled={editSubmitting || !editContent.trim()}
									>
										{editSubmitting ? 'Saving...' : 'Save'}
									</button>
								</div>
							</div>
						{:else}
							<p class="comment-content">{@html comment.content
								.replace(/&/g, '&amp;')
								.replace(/</g, '&lt;')
								.replace(/>/g, '&gt;')
								.replace(/\n/g, '<br>')}</p>
						{/if}
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

{#if mediaItems.length > 0}
	<ImageLightbox
		media={mediaItems}
		currentIndex={lightboxIndex}
		open={lightboxOpen}
		onclose={closeLightbox}
	/>
{/if}

<ConfirmDialog
	open={deleteDialogOpen}
	title="Delete Comment"
	message="Are you sure you want to delete this comment? This action cannot be undone."
	confirmText="Delete"
	cancelText="Cancel"
	variant="danger"
	onconfirm={confirmDelete}
	oncancel={cancelDelete}
/>

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
		color: var(--color-text-muted);
		line-height: 1.6;
		margin: 0 0 1.5rem 0;
	}

	.media-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.media-button {
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: transform 0.2s, box-shadow 0.2s;
	}

	.media-button:hover {
		transform: scale(1.02);
		box-shadow: var(--shadow-lg);
	}

	.entry-media {
		width: 100%;
		border-radius: var(--radius-md);
		object-fit: cover;
		aspect-ratio: 4/3;
		display: block;
	}

	.video-thumbnail {
		position: relative;
		width: 100%;
		aspect-ratio: 4/3;
		background: var(--color-bg-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.video-placeholder {
		width: 100%;
		height: 100%;
		background: linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-bg-tertiary, #333) 100%);
	}

	.play-icon {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 64px;
		height: 64px;
		background: rgba(0, 0, 0, 0.6);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.2s;
	}

	.media-button:hover .play-icon {
		background: rgba(0, 0, 0, 0.8);
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
		transition: box-shadow 0.3s ease, background-color 0.3s ease;
	}

	.comment-highlight {
		animation: highlight-pulse 4s ease-out;
	}

	@keyframes highlight-pulse {
		0% {
			box-shadow: 0 0 0 3px var(--color-primary);
			background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bg));
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
			background: var(--color-bg);
		}
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

	/* Comment moderation and edit/delete styles */
	.comment-hidden {
		opacity: 0.6;
		border-left: 3px solid var(--color-warning, #f59e0b);
	}

	.comment-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.comment-edited {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.comment-hidden-badge {
		font-size: 0.65rem;
		padding: 0.125rem 0.375rem;
		background: var(--color-warning, #f59e0b);
		color: white;
		border-radius: var(--radius-sm);
		font-weight: 600;
		text-transform: uppercase;
	}

	.comment-hidden-icon {
		display: inline-flex;
		align-items: center;
		color: var(--color-warning, #f59e0b);
	}

	.comment-actions {
		display: flex;
		gap: 0.25rem;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text-muted);
		transition: background-color 0.15s, color 0.15s;
	}

	.action-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.edit-btn:hover:not(:disabled) {
		color: var(--color-primary);
	}

	.delete-btn:hover:not(:disabled) {
		color: var(--color-danger, #ef4444);
	}

	.hide-btn:hover:not(:disabled) {
		color: var(--color-warning, #f59e0b);
	}

	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spinner-spin 0.6s linear infinite;
	}

	@keyframes spinner-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.edit-form {
		margin: 0.5rem 0;
	}

	.edit-form textarea {
		width: 100%;
		padding: 0.75rem;
		font-size: 0.875rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		resize: vertical;
		min-height: 80px;
	}

	.edit-form textarea:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
	}

	.edit-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}

	.btn-secondary,
	.btn-primary {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background-color 0.15s, opacity 0.15s;
	}

	.btn-secondary {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--color-bg-tertiary, var(--color-border));
	}

	.btn-primary {
		background: var(--color-primary);
		border: none;
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.9;
	}

	.btn-secondary:disabled,
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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

		.media-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
