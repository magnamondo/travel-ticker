<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ChunkedUploader from '$lib/components/ChunkedUploader.svelte';
	import VideoThumbnail from '$lib/components/VideoThumbnail.svelte';
	import type { UploadResult } from '$lib/upload';
	import { SvelteMap } from 'svelte/reactivity';
	import { untrack } from 'svelte';
	import { toasts } from '$lib/stores/toast.svelte';

	type MetaItem = {
		type: 'coordinates' | 'link' | 'icon';
		value: string;
		label?: string;
		icon?: string;
	};

	let { data, form } = $props();

	// Track last shown toast to avoid duplicates
	let lastToastMessage = $state<string | null>(null);

	// Show toast when form result changes
	$effect(() => {
		const message = form?.success ? form?.message : form?.error;
		const lastShown = untrack(() => lastToastMessage);
		
		if (message && message !== lastShown) {
			lastToastMessage = message;
			if (form?.success) {
				toasts.success(message);
			} else {
				toasts.error(message);
			}
		}
	});

	let editingMilestoneId = $state<string | null>(null);
	let editingSegmentId = $state<string | null>(null);
	let showAddMediaFor = $state<string | null>(null);
	let uploadModeFor = $state<string | null>(null);
	let uploadingMedia = $state(false);
	let uploadSuccess = $state<string | null>(null);
	let draggingMediaId = $state<string | null>(null);
	let dragOverMediaId = $state<string | null>(null);

	// Milestone drag state
	let draggingMilestoneId = $state<string | null>(null);
	let dragOverMilestoneId = $state<string | null>(null);
	let currentDragMilestones = $state<Array<{ id: string; date: Date; sortOrder: number }>>([]);

	// Touch drag state for mobile (media)
	let touchDraggingMediaId = $state<string | null>(null);
	let touchDragOverMediaId = $state<string | null>(null);
	let touchStartY = $state(0);
	let touchStartX = $state(0);
	let touchCloneInitialLeft = $state(0);
	let touchCloneInitialTop = $state(0);
	let touchCurrentMilestoneMedia = $state<Array<{ id: string; sortOrder: number }>>([]);
	let touchDragClone = $state<HTMLElement | null>(null);

	// Touch drag state for milestones
	let touchDraggingMilestoneId = $state<string | null>(null);
	let touchDragOverMilestoneId = $state<string | null>(null);
	let touchMilestoneStartY = $state(0);
	let touchMilestoneStartX = $state(0);
	let touchMilestoneCloneInitialLeft = $state(0);
	let touchMilestoneCloneInitialTop = $state(0);
	let touchCurrentMilestones = $state<Array<{ id: string; date: Date; sortOrder: number }>>([]);
	let touchMilestoneDragClone = $state<HTMLElement | null>(null);

	// Track edited meta per milestone
	let milestoneMetaMap = new SvelteMap<string, MetaItem[]>();

	// Initialize meta when editing starts
	$effect(() => {
		const milestoneId = editingMilestoneId;
		if (milestoneId) {
			// Use untrack to prevent the map read from creating a dependency
			const hasEntry = untrack(() => milestoneMetaMap.has(milestoneId));
			if (!hasEntry) {
				// Find the milestone being edited (untrack data access to prevent loops on data refresh)
				const entries = untrack(() => data.groupedEntries);
				for (const group of entries) {
					const found = group.milestones.find(m => m.id === milestoneId);
					if (found) {
						milestoneMetaMap.set(milestoneId, [...(found.meta ?? [])]);
						break;
					}
				}
			}
		}
	});

	function getMeta(milestoneId: string, originalMeta: MetaItem[] | null): MetaItem[] {
		return milestoneMetaMap.get(milestoneId) ?? originalMeta ?? [];
	}

	function addMetaItem(milestoneId: string) {
		const current = milestoneMetaMap.get(milestoneId) ?? [];
		milestoneMetaMap.set(milestoneId, [...current, { type: 'coordinates', value: '' }]);
	}

	function removeMetaItem(milestoneId: string, index: number) {
		const current = milestoneMetaMap.get(milestoneId) ?? [];
		milestoneMetaMap.set(milestoneId, current.filter((_, i) => i !== index));
	}

	function updateMetaItem(milestoneId: string, index: number, field: keyof MetaItem, value: string) {
		const current = milestoneMetaMap.get(milestoneId) ?? [];
		const updated = [...current];
		if (field === 'type') {
			updated[index] = { ...updated[index], type: value as MetaItem['type'] };
		} else {
			updated[index] = { ...updated[index], [field]: value || undefined };
		}
		milestoneMetaMap.set(milestoneId, updated);
	}

	function getMetaJson(milestoneId: string): string {
		const meta = milestoneMetaMap.get(milestoneId) ?? [];
		// Filter out empty entries
		const filtered = meta.filter(m => m.value.trim() !== '');
		return JSON.stringify(filtered);
	}

	function autoResize(node: HTMLTextAreaElement) {
		const resize = () => {
			node.style.height = 'auto';
			node.style.height = node.scrollHeight + 'px';
		};
		resize();
		return { update: resize };
	}

	function formatDate(date: Date) {
		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(date);
	}

	function formatDateForInput(date: Date) {
		return date.toISOString().split('T')[0];
	}

	async function handleMilestoneUpload(milestoneId: string, result: UploadResult) {
		// After upload, add the media via fetch (no page reload)
		const mediaType = result.mimeType.startsWith('video/') ? 'video' : 'image';
		
		const formData = new FormData();
		formData.append('milestoneId', milestoneId);
		formData.append('type', mediaType);
		formData.append('url', result.url);
		formData.append('thumbnailUrl', result.thumbnailUrl || '');
		formData.append('caption', '');
		formData.append('videoJobId', result.videoProcessingJobId || '');
		
		try {
			const response = await fetch('?/addMedia', {
				method: 'POST',
				body: formData
			});
			
			if (response.ok) {
				// Refresh data without closing the form
				await invalidateAll();
				uploadSuccess = 'Media added!';
				setTimeout(() => { uploadSuccess = null; }, 3000);
			}
		} catch (err) {
			console.error('Failed to add media:', err);
		}
	}
	
	async function handleAllUploadsComplete(milestoneId: string, results: UploadResult[]) {
		// Handle multiple uploads completing - add all media
		uploadingMedia = true;
		
		for (const result of results) {
			await handleMilestoneUpload(milestoneId, result);
		}
		
		uploadingMedia = false;
	}
	
	// Drag and drop reordering for media
	function handleMediaDragStart(e: DragEvent, mediaId: string) {
		draggingMediaId = mediaId;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', mediaId);
		}
	}
	
	function handleMediaDragOver(e: DragEvent, mediaId: string) {
		e.preventDefault();
		if (draggingMediaId && draggingMediaId !== mediaId) {
			dragOverMediaId = mediaId;
		}
	}
	
	function handleMediaDragLeave() {
		dragOverMediaId = null;
	}
	
	function handleMediaDragEnd() {
		draggingMediaId = null;
		dragOverMediaId = null;
	}
	
	async function handleMediaDrop(e: DragEvent, targetMediaId: string, milestoneMedia: Array<{ id: string; sortOrder: number }>) {
		e.preventDefault();
		dragOverMediaId = null;
		
		if (!draggingMediaId || draggingMediaId === targetMediaId) {
			draggingMediaId = null;
			return;
		}
		
		await reorderMedia(draggingMediaId, targetMediaId, milestoneMedia);
		draggingMediaId = null;
	}

	// Shared reorder logic for both mouse and touch
	async function reorderMedia(fromMediaId: string, toMediaId: string, milestoneMedia: Array<{ id: string; sortOrder: number }>) {
		// Find indices
		const fromIndex = milestoneMedia.findIndex(m => m.id === fromMediaId);
		const toIndex = milestoneMedia.findIndex(m => m.id === toMediaId);
		
		if (fromIndex === -1 || toIndex === -1) {
			return;
		}
		
		// Create new order
		const reordered = [...milestoneMedia];
		const [removed] = reordered.splice(fromIndex, 1);
		reordered.splice(toIndex, 0, removed);
		
		// Build order data with new sortOrder values
		const order = reordered.map((item, index) => ({
			id: item.id,
			sortOrder: index
		}));
		
		// Save to server
		const formData = new FormData();
		formData.append('order', JSON.stringify(order));
		
		try {
			const response = await fetch('?/reorderMedia', {
				method: 'POST',
				body: formData
			});
			
			if (response.ok) {
				await invalidateAll();
			}
		} catch (err) {
			console.error('Failed to reorder media:', err);
		}
	}

	// Touch event handlers for mobile drag and drop
	function handleMediaTouchStart(e: TouchEvent, mediaId: string, milestoneMedia: Array<{ id: string; sortOrder: number }>) {
		const touch = e.touches[0];
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchDraggingMediaId = mediaId;
		touchCurrentMilestoneMedia = milestoneMedia;
		
		// Create a visual clone for dragging
		const target = e.currentTarget as HTMLElement;
		const clone = target.cloneNode(true) as HTMLElement;
		const rect = target.getBoundingClientRect();
		
		// Store initial clone position
		touchCloneInitialLeft = rect.left;
		touchCloneInitialTop = rect.top;
		
		clone.classList.add('touch-drag-clone');
		clone.style.position = 'fixed';
		clone.style.left = `${rect.left}px`;
		clone.style.top = `${rect.top}px`;
		clone.style.width = `${rect.width}px`;
		clone.style.height = `${rect.height}px`;
		clone.style.zIndex = '10000';
		clone.style.pointerEvents = 'none';
		clone.style.opacity = '0.8';
		clone.style.transform = 'scale(1.1)';
		clone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
		
		document.body.appendChild(clone);
		touchDragClone = clone;
	}

	function handleMediaTouchMove(e: TouchEvent) {
		if (!touchDraggingMediaId || !touchDragClone) return;
		
		e.preventDefault(); // Prevent scrolling while dragging
		
		const touch = e.touches[0];
		const deltaX = touch.clientX - touchStartX;
		const deltaY = touch.clientY - touchStartY;
		
		// Move the clone based on initial position + delta
		touchDragClone.style.left = `${touchCloneInitialLeft + deltaX}px`;
		touchDragClone.style.top = `${touchCloneInitialTop + deltaY}px`;
		
		// Find element under touch point
		touchDragClone.style.display = 'none';
		const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
		touchDragClone.style.display = '';
		
		// Find the media-thumb ancestor
		const thumbBelow = elementBelow?.closest('.media-thumb') as HTMLElement | null;
		if (thumbBelow) {
			const mediaId = thumbBelow.dataset.mediaId;
			if (mediaId && mediaId !== touchDraggingMediaId) {
				touchDragOverMediaId = mediaId;
			} else {
				touchDragOverMediaId = null;
			}
		} else {
			touchDragOverMediaId = null;
		}
	}

	async function handleMediaTouchEnd() {
		// Remove the clone
		if (touchDragClone) {
			touchDragClone.remove();
			touchDragClone = null;
		}

		// Perform reorder if we have a valid drop target
		if (touchDraggingMediaId && touchDragOverMediaId && touchDraggingMediaId !== touchDragOverMediaId) {
			await reorderMedia(touchDraggingMediaId, touchDragOverMediaId, touchCurrentMilestoneMedia);
		}

		// Reset touch state
		touchDraggingMediaId = null;
		touchDragOverMediaId = null;
		touchCurrentMilestoneMedia = [];
	}

	// Helper to check if two dates are the same day
	function isSameDay(a: Date, b: Date): boolean {
		return a.getFullYear() === b.getFullYear() &&
			a.getMonth() === b.getMonth() &&
			a.getDate() === b.getDate();
	}

	// Milestone drag and drop handlers
	function handleMilestoneDragStart(e: DragEvent, milestoneId: string, milestones: Array<{ id: string; date: Date; sortOrder: number }>) {
		draggingMilestoneId = milestoneId;
		currentDragMilestones = milestones;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', milestoneId);
		}
	}

	function handleMilestoneDragOver(e: DragEvent, milestoneId: string, milestoneDate: Date) {
		e.preventDefault();
		if (!draggingMilestoneId || draggingMilestoneId === milestoneId) return;

		// Find dragging milestone date
		const draggingMilestone = currentDragMilestones.find(m => m.id === draggingMilestoneId);
		if (!draggingMilestone) return;

		// Only allow drop on same day
		if (isSameDay(draggingMilestone.date, milestoneDate)) {
			dragOverMilestoneId = milestoneId;
		}
	}

	function handleMilestoneDragLeave() {
		dragOverMilestoneId = null;
	}

	function handleMilestoneDragEnd() {
		draggingMilestoneId = null;
		dragOverMilestoneId = null;
		currentDragMilestones = [];
	}

	async function handleMilestoneDrop(e: DragEvent, targetMilestoneId: string) {
		e.preventDefault();
		dragOverMilestoneId = null;

		if (!draggingMilestoneId || draggingMilestoneId === targetMilestoneId) {
			draggingMilestoneId = null;
			return;
		}

		await reorderMilestones(draggingMilestoneId, targetMilestoneId, currentDragMilestones);
		draggingMilestoneId = null;
		currentDragMilestones = [];
	}

	// Shared reorder logic for milestones
	async function reorderMilestones(fromId: string, toId: string, milestones: Array<{ id: string; date: Date; sortOrder: number }>) {
		const fromIdx = milestones.findIndex(m => m.id === fromId);
		const toIdx = milestones.findIndex(m => m.id === toId);

		if (fromIdx === -1 || toIdx === -1) return;

		// Only allow same-day reordering
		if (!isSameDay(milestones[fromIdx].date, milestones[toIdx].date)) return;

		// Create new order
		const reordered = [...milestones];
		const [removed] = reordered.splice(fromIdx, 1);
		reordered.splice(toIdx, 0, removed);

		// Build order data - only update milestones that share the same date as the dragged item
		const draggedDate = milestones[fromIdx].date;
		const sameDayMilestones = reordered.filter(m => isSameDay(m.date, draggedDate));
		const order = sameDayMilestones.map((item, index) => ({
			id: item.id,
			sortOrder: index
		}));

		const formData = new FormData();
		formData.append('order', JSON.stringify(order));

		try {
			const response = await fetch('?/reorderMilestones', {
				method: 'POST',
				body: formData
			});

			if (response.ok) {
				await invalidateAll();
			}
		} catch (err) {
			console.error('Failed to reorder milestones:', err);
		}
	}

	// Touch event handlers for milestone drag and drop
	function handleMilestoneTouchStart(e: TouchEvent, milestoneId: string, milestones: Array<{ id: string; date: Date; sortOrder: number }>) {
		const touch = e.touches[0];
		touchMilestoneStartX = touch.clientX;
		touchMilestoneStartY = touch.clientY;
		touchDraggingMilestoneId = milestoneId;
		touchCurrentMilestones = milestones;

		// Find the parent milestone card to clone
		const handle = e.currentTarget as HTMLElement;
		const card = handle.closest('.milestone-card') as HTMLElement;
		if (!card) return;

		const clone = card.cloneNode(true) as HTMLElement;
		const rect = card.getBoundingClientRect();

		touchMilestoneCloneInitialLeft = rect.left;
		touchMilestoneCloneInitialTop = rect.top;

		clone.classList.add('touch-milestone-drag-clone');
		clone.style.position = 'fixed';
		clone.style.left = `${rect.left}px`;
		clone.style.top = `${rect.top}px`;
		clone.style.width = `${rect.width}px`;
		clone.style.height = `${rect.height}px`;
		clone.style.zIndex = '10000';
		clone.style.pointerEvents = 'none';
		clone.style.opacity = '0.9';
		clone.style.transform = 'scale(1.02)';
		clone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

		document.body.appendChild(clone);
		touchMilestoneDragClone = clone;
	}

	function handleMilestoneTouchMove(e: TouchEvent) {
		if (!touchDraggingMilestoneId || !touchMilestoneDragClone) return;

		e.preventDefault();

		const touch = e.touches[0];
		const deltaX = touch.clientX - touchMilestoneStartX;
		const deltaY = touch.clientY - touchMilestoneStartY;

		touchMilestoneDragClone.style.left = `${touchMilestoneCloneInitialLeft + deltaX}px`;
		touchMilestoneDragClone.style.top = `${touchMilestoneCloneInitialTop + deltaY}px`;

		// Find element under touch point
		touchMilestoneDragClone.style.display = 'none';
		const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
		touchMilestoneDragClone.style.display = '';

		// Find the milestone-card ancestor
		const cardBelow = elementBelow?.closest('.milestone-card') as HTMLElement | null;
		if (cardBelow) {
			const milestoneId = cardBelow.dataset.milestoneId;
			const milestoneDate = cardBelow.dataset.milestoneDate;
			if (milestoneId && milestoneId !== touchDraggingMilestoneId && milestoneDate) {
				// Check if same day
				const draggingMilestone = touchCurrentMilestones.find(m => m.id === touchDraggingMilestoneId);
				if (draggingMilestone && isSameDay(draggingMilestone.date, new Date(milestoneDate))) {
					touchDragOverMilestoneId = milestoneId;
				} else {
					touchDragOverMilestoneId = null;
				}
			} else {
				touchDragOverMilestoneId = null;
			}
		} else {
			touchDragOverMilestoneId = null;
		}
	}

	async function handleMilestoneTouchEnd() {
		if (touchMilestoneDragClone) {
			touchMilestoneDragClone.remove();
			touchMilestoneDragClone = null;
		}

		if (touchDraggingMilestoneId && touchDragOverMilestoneId && touchDraggingMilestoneId !== touchDragOverMilestoneId) {
			await reorderMilestones(touchDraggingMilestoneId, touchDragOverMilestoneId, touchCurrentMilestones);
		}

		touchDraggingMilestoneId = null;
		touchDragOverMilestoneId = null;
		touchCurrentMilestones = [];
	}

	// Check if a milestone has same-day neighbors (for showing drag hint)
	function hasSameDayNeighbors(milestoneId: string, milestones: Array<{ id: string; date: Date }>): boolean {
		const idx = milestones.findIndex(m => m.id === milestoneId);
		if (idx === -1) return false;

		const prev = idx > 0 && isSameDay(milestones[idx].date, milestones[idx - 1].date);
		const next = idx < milestones.length - 1 && isSameDay(milestones[idx].date, milestones[idx + 1].date);
		return prev || next;
	}

	// Action to attach touchmove with passive: false (needed for preventDefault)
	function nonPassiveTouchMove(node: HTMLElement, handler: (e: TouchEvent) => void) {
		node.addEventListener('touchmove', handler, { passive: false });
		return {
			update(newHandler: (e: TouchEvent) => void) {
				node.removeEventListener('touchmove', handler);
				handler = newHandler;
				node.addEventListener('touchmove', handler, { passive: false });
			},
			destroy() {
				node.removeEventListener('touchmove', handler);
			}
		};
	}
</script>

<div class="entries-page">
	<div class="page-header">
		<h1>Timeline Entries</h1>
	</div>

	<!-- Add New Segment Bar -->
	<div class="add-segment-bar">
		<form method="POST" action="?/addSegment" use:enhance class="add-segment-form">
			<span class="bar-label">New Segment:</span>
			<input type="text" name="icon" required placeholder="🇫🇷" class="icon-input" />
			<input type="text" name="name" required placeholder="Segment name" class="name-input" />
			<input type="hidden" name="sortOrder" value={data.segments.length} />
			<button type="submit" class="btn-primary">Add</button>
		</form>
	</div>

	<!-- Entries List grouped by Segment -->
	<div class="entries-list">
		{#each data.groupedEntries as group (group.segment.id)}
			<div class="segment-group">
				{#if editingSegmentId === group.segment.id}
					<form method="POST" action="?/updateSegment" use:enhance class="segment-edit-form" onsubmit={() => (editingSegmentId = null)}>
						<input type="hidden" name="segmentId" value={group.segment.id} />
						<input type="text" name="icon" value={group.segment.icon} class="segment-icon-input" required />
						<input type="text" name="name" value={group.segment.name} class="segment-name-input" required />
						<input type="number" name="sortOrder" value={group.segment.sortOrder} class="segment-order-input" title="Sort order" />
						<button type="submit" class="btn-icon-small save" title="Save">✓</button>
						<button type="button" class="btn-icon-small" onclick={() => (editingSegmentId = null)} title="Cancel">✕</button>
					</form>
				{:else}
					<div class="segment-header">
						<span class="segment-icon">{group.segment.icon}</span>
						<span class="segment-name">{group.segment.name}</span>
						<span class="segment-count">{group.milestones.length} entries</span>
						<div class="segment-actions">
							<form method="POST" action="?/createDraft" use:enhance={() => {
								return async ({ result, update }) => {
									await update();
									if (result.type === 'success' && result.data?.milestoneId) {
										editingMilestoneId = result.data.milestoneId as string;
									}
								};
							}} class="inline">
								<input type="hidden" name="segmentId" value={group.segment.id} />
								<button type="submit" class="btn-icon-small add" title="New entry">+</button>
							</form>
							<button class="btn-icon-small" onclick={() => (editingSegmentId = group.segment.id)} title="Edit segment">✏️</button>
							<form method="POST" action="?/deleteSegment" use:enhance class="inline">
								<input type="hidden" name="segmentId" value={group.segment.id} />
								<button
									type="submit"
									class="btn-icon-small danger"
									title="Delete segment"
									disabled={group.milestones.length > 0}
									onsubmit={(e) => {
										if (!confirm('Delete this segment?')) e.preventDefault();
									}}
								>
									×
								</button>
							</form>
						</div>
					</div>
				{/if}
				<div class="milestones">
					{#each group.milestones as milestone (milestone.id)}
							<div
								class="milestone-card"
								role="listitem"
								class:draft={!milestone.published}
								class:editing={editingMilestoneId === milestone.id}
								class:dragging={draggingMilestoneId === milestone.id || touchDraggingMilestoneId === milestone.id}
								class:drag-over={dragOverMilestoneId === milestone.id || touchDragOverMilestoneId === milestone.id}
								class:draggable={hasSameDayNeighbors(milestone.id, group.milestones)}
								data-milestone-id={milestone.id}
								data-milestone-date={milestone.date.toISOString()}
								draggable={hasSameDayNeighbors(milestone.id, group.milestones)}
								ondragstart={(e) => handleMilestoneDragStart(e, milestone.id, group.milestones)}
								ondragover={(e) => handleMilestoneDragOver(e, milestone.id, milestone.date)}
								ondragleave={handleMilestoneDragLeave}
								ondragend={handleMilestoneDragEnd}
								ondrop={(e) => handleMilestoneDrop(e, milestone.id)}
							>
								<div class="milestone-row-wrapper">
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="drag-handle-milestone"
										class:disabled={!hasSameDayNeighbors(milestone.id, group.milestones)}
										title={hasSameDayNeighbors(milestone.id, group.milestones) ? "Drag to reorder" : ""}
										ontouchstart={(e) => hasSameDayNeighbors(milestone.id, group.milestones) && handleMilestoneTouchStart(e, milestone.id, group.milestones)}
										use:nonPassiveTouchMove={handleMilestoneTouchMove}
										ontouchend={handleMilestoneTouchEnd}
									>⋮⋮</div>
									<button type="button" class="milestone-row" onclick={() => (editingMilestoneId = editingMilestoneId === milestone.id ? null : milestone.id)}>
										<span class="published-indicator" class:published={milestone.published} title={milestone.published ? 'Published' : 'Draft'}>
											{milestone.published ? '●' : '○'}
										</span>
										<span class="milestone-date">{formatDate(milestone.date)}</span>
										<span class="milestone-title">{milestone.title}</span>
									</button>
								</div>
								{#if editingMilestoneId === milestone.id}
									<div class="milestone-edit-panel">
								<form id="edit-form-{milestone.id}" method="POST" action="?/updateMilestone" use:enhance={() => {
									return async ({ result, update }) => {
										await update();
										if (result.type === 'success') {
											editingMilestoneId = null;
										}
									};
								}} class="milestone-edit-form">
									<input type="hidden" name="milestoneId" value={milestone.id} />
									<input type="hidden" name="published" value={milestone.published ? 'on' : ''} />
									<input type="hidden" name="meta" value={getMetaJson(milestone.id)} />
									<div class="edit-form-grid">
										<div class="form-field">
											<label for="edit-segment-{milestone.id}">Segment</label>
											<select id="edit-segment-{milestone.id}" name="segmentId" required>
												{#each data.segments as seg (seg.id)}
													<option value={seg.id} selected={seg.id === milestone.segmentId}>
														{seg.icon} {seg.name}
													</option>
												{/each}
											</select>
										</div>
										<div class="form-field">
											<label for="edit-title-{milestone.id}">Title</label>
											<input type="text" id="edit-title-{milestone.id}" name="title" value={milestone.title} required />
										</div>
										<div class="form-field">
											<label for="edit-date-{milestone.id}">Date</label>
											<input type="date" id="edit-date-{milestone.id}" name="date" value={formatDateForInput(milestone.date)} required />
										</div>
										<div class="form-field full-width">
											<label for="edit-desc-{milestone.id}">Description</label>
											<textarea 
												id="edit-desc-{milestone.id}" 
												name="description" 
												rows="1" 
												placeholder="Optional description"
												oninput={(e) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'; }}
												use:autoResize
											>{milestone.description || ''}</textarea>
										</div>
									</div>
								</form>

								<!-- Media Section -->
								<div class="edit-media-section">
									<h4>Media</h4>
									{#if milestone.media.length > 0}
										<div class="media-strip" role="list">
											{#each milestone.media as item (item.id)}
												<div 
													class="media-thumb"
													class:dragging={draggingMediaId === item.id || touchDraggingMediaId === item.id}
													class:drag-over={dragOverMediaId === item.id || touchDragOverMediaId === item.id}
													draggable="true"
													role="listitem"
													data-media-id={item.id}
													ondragstart={(e) => handleMediaDragStart(e, item.id)}
													ondragover={(e) => handleMediaDragOver(e, item.id)}
													ondragleave={handleMediaDragLeave}
													ondragend={handleMediaDragEnd}
													ondrop={(e) => handleMediaDrop(e, item.id, milestone.media)}
													ontouchstart={(e) => handleMediaTouchStart(e, item.id, milestone.media)}
													use:nonPassiveTouchMove={handleMediaTouchMove}
													ontouchend={handleMediaTouchEnd}
												>
													<div class="drag-handle" title="Drag to reorder">⋮⋮</div>
													{#if item.type === 'video'}
														<VideoThumbnail
															url={item.url}
															thumbnailUrl={item.thumbnailUrl}
															videoJobId={item.videoJobId}
														/>
													{:else}
														<img src={item.url} alt="" />
													{/if}
													<form method="POST" action="?/deleteMedia" use:enhance class="delete-media-form">
														<input type="hidden" name="mediaId" value={item.id} />
														<button type="submit" class="media-delete-btn">×</button>
													</form>
												</div>
											{/each}
										</div>
										<p class="reorder-hint">Drag or hold & drag to reorder</p>
									{:else}
										<p class="no-media-hint">No media attached</p>
									{/if}

									{#if showAddMediaFor === milestone.id}
										<form method="POST" action="?/addMedia" use:enhance class="add-media-inline" onsubmit={() => { showAddMediaFor = null; }}>
											<input type="hidden" name="milestoneId" value={milestone.id} />
											<div class="media-form-fields">
												<select name="type" required>
													<option value="image">Image</option>
													<option value="video">Video</option>
												</select>
												<input type="url" name="url" placeholder="URL" required />
												<input type="url" name="thumbnailUrl" placeholder="Thumbnail (videos)" />
												<input type="text" name="caption" placeholder="Caption" />
												<button type="submit" class="btn-small-primary">Add</button>
												<button type="button" class="btn-small-secondary" onclick={() => (showAddMediaFor = null)}>×</button>
											</div>
										</form>
									{:else if uploadModeFor === milestone.id || milestone.media.length === 0}
										<div class="uploader-section">
											{#if uploadSuccess}
												<div class="upload-success-msg">{uploadSuccess}</div>
											{/if}
											<ChunkedUploader 
												milestoneId={milestone.id}
												accept="image/*,video/*"
												multiple={true}
												onUploadComplete={(result) => handleMilestoneUpload(milestone.id, result)}
												onAllUploadsComplete={(results) => handleAllUploadsComplete(milestone.id, results)}
											/>
											<button type="button" class="btn-small-secondary" onclick={() => (uploadModeFor = null)}>Done</button>
										</div>
									{:else}
										<button class="add-media-btn" onclick={() => (uploadModeFor = milestone.id)}>
											Upload files
										</button>
									{/if}
								</div>

								<!-- Meta Section -->
								<div class="edit-meta-section">
									<h4>Meta Links & Info</h4>
									{#each getMeta(milestone.id, milestone.meta) as metaItem, i (i)}
										<div class="meta-row">
											<select 
												value={metaItem.type}
												onchange={(e) => updateMetaItem(milestone.id, i, 'type', e.currentTarget.value)}
											>
												<option value="coordinates">📍 Coordinates</option>
												<option value="link">🔗 Link</option>
												<option value="icon">✨ Icon</option>
											</select>
											<input 
												type="text" 
												placeholder={metaItem.type === 'coordinates' ? 'lat,lng' : metaItem.type === 'link' ? 'https://...' : 'emoji'}
												value={metaItem.value}
												oninput={(e) => updateMetaItem(milestone.id, i, 'value', e.currentTarget.value)}
											/>
											<input 
												type="text" 
												placeholder="Label (optional)"
												value={metaItem.label || ''}
												oninput={(e) => updateMetaItem(milestone.id, i, 'label', e.currentTarget.value)}
											/>
											{#if metaItem.type !== 'coordinates'}
												<input 
													type="text" 
													placeholder="Icon"
													value={metaItem.icon || ''}
													oninput={(e) => updateMetaItem(milestone.id, i, 'icon', e.currentTarget.value)}
													class="icon-field"
												/>
											{/if}
											<button type="button" class="meta-remove-btn" onclick={() => removeMetaItem(milestone.id, i)}>×</button>
										</div>
									{/each}
									<button type="button" class="add-meta-btn" onclick={() => addMetaItem(milestone.id)}>
										+ Add meta
									</button>
								</div>

								<div class="edit-panel-footer">
									<label class="checkbox-label">
										<input type="checkbox" checked={milestone.published} onchange={(e) => {
											const form = document.getElementById(`edit-form-${milestone.id}`) as HTMLFormElement;
											if (form) {
												const input = form.querySelector('input[name="published"]') as HTMLInputElement;
												if (input) input.value = e.currentTarget.checked ? 'on' : '';
											}
										}} />
										<span>Published</span>
									</label>
									<div class="footer-buttons">
										<form method="POST" action="?/deleteMilestone" use:enhance={() => {
											return async ({ result }) => {
												if (result.type === 'success') {
													editingMilestoneId = null;
													toasts.success('Entry deleted!');
													await invalidateAll();
												} else if (result.type === 'failure') {
													toasts.error('Failed to delete entry');
												}
											};
										}} class="delete-entry-form">
											<input type="hidden" name="milestoneId" value={milestone.id} />
											<button type="submit" class="btn-danger" onclick={(e) => {
												if (!confirm('Delete this entry and all its media?')) e.preventDefault();
											}}>Delete</button>
										</form>
										<button type="button" class="btn-secondary" onclick={() => { editingMilestoneId = null; uploadModeFor = null; showAddMediaFor = null; }}>Cancel</button>
										<button type="submit" form="edit-form-{milestone.id}" class="btn-primary">Save</button>
									</div>
								</div>
							</div>
						{/if}
					</div>
					{/each}
				</div>
			</div>
		{:else}
			<div class="empty-state">
				<p>No entries yet. Add your first entry above!</p>
			</div>
		{/each}
	</div>
</div>

<style>
	.entries-page h1 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 1.5rem;
	}

	.add-segment-bar {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem;
		margin-bottom: 1.5rem;
	}

	.add-segment-form {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.bar-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.icon-input {
		width: 3rem;
		text-align: center;
		font-size: 1.25rem;
	}

	.name-input {
		flex: 1;
		min-width: 150px;
	}

	.milestone-edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.form-field.full-width {
		flex: 1;
		min-width: 200px;
	}

	label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	input,
	select {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.875rem;
	}

	input:focus,
	select:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.btn-primary {
		padding: 0.5rem 1rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}

	.btn-secondary {
		padding: 0.5rem 1rem;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		white-space: nowrap;
		text-decoration: none;
	}

	.btn-danger {
		padding: 0.5rem 1rem;
		background: var(--color-danger);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}

	.btn-danger:hover {
		background: color-mix(in srgb, var(--color-danger) 85%, black);
	}

	.delete-entry-form {
		display: contents;
	}

	.btn-icon-small {
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.875rem;
		text-decoration: none;
	}

	.btn-icon-small:hover {
		background: var(--color-bg-secondary);
	}

	.btn-icon-small.danger:hover {
		background: var(--color-error);
		color: white;
	}

	.btn-icon-small:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.entries-list {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.segment-group {
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.segment-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.segment-icon {
		font-size: 1.25rem;
	}

	.segment-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.segment-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-left: auto;
	}

	.segment-actions {
		display: flex;
		gap: 0.25rem;
	}

	.segment-edit-form {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.segment-icon-input {
		width: 3rem;
		text-align: center;
		font-size: 1.25rem;
		padding: 0.25rem;
	}

	.segment-name-input {
		flex: 1;
		min-width: 100px;
		padding: 0.375rem 0.5rem;
		font-weight: 600;
	}

	.segment-order-input {
		width: 4rem;
		text-align: center;
		padding: 0.375rem 0.5rem;
	}

	.btn-icon-small.save {
		color: var(--color-success, #10b981);
	}

	.milestones {
		display: flex;
		flex-direction: column;
	}

	.milestone-card {
		border-bottom: 1px solid var(--color-border);
	}

	.milestone-card.draft {
		background: repeating-linear-gradient(
			-45deg,
			transparent,
			transparent 10px,
			rgba(251, 191, 36, 0.05) 10px,
			rgba(251, 191, 36, 0.05) 20px
		);
	}

	.milestone-card.editing {
		background: var(--color-bg-secondary);
	}

	.milestone-card.editing .milestone-row {
		background: rgba(59, 130, 246, 0.15);
	}

	.btn-icon-small.add {
		background: var(--color-primary);
		color: white;
		font-weight: 600;
	}

	.btn-icon-small.add:hover {
		background: var(--color-primary-hover, #2563eb);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.checkbox-label input[type="checkbox"] {
		width: 1rem;
		height: 1rem;
		cursor: pointer;
	}

	.milestone-card:last-child {
		border-bottom: none;
	}

	.milestone-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		width: 100%;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		font: inherit;
	}

	.milestone-row:hover {
		background: var(--color-bg-secondary);
	}

	.milestone-row-wrapper {
		display: flex;
		align-items: stretch;
	}

	.drag-handle-milestone {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 0.5rem;
		color: var(--color-text-muted);
		cursor: grab;
		font-size: 0.875rem;
		letter-spacing: -2px;
		opacity: 0.5;
		transition: opacity 0.15s, color 0.15s;
		user-select: none;
	}

	.drag-handle-milestone:not(.disabled):hover {
		opacity: 1;
		color: var(--color-primary);
	}

	.drag-handle-milestone.disabled {
		opacity: 0.2;
		cursor: default;
		pointer-events: none;
	}

	.milestone-card.draggable {
		cursor: grab;
	}

	.milestone-card.draggable:active {
		cursor: grabbing;
	}

	.milestone-card.dragging {
		opacity: 0.5;
		background: var(--color-bg-secondary);
	}

	.milestone-card.drag-over {
		box-shadow: inset 0 0 0 2px var(--color-primary);
		background: rgba(59, 130, 246, 0.1);
	}

	.milestone-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		min-width: 80px;
	}

	.milestone-title {
		font-weight: 500;
		color: var(--color-text);
		flex: 1;
	}

	.published-indicator {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.published-indicator.published {
		color: var(--color-success, #10b981);
	}

	textarea {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.875rem;
		font-family: inherit;
		resize: vertical;
	}

	textarea:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	/* Unified Edit Panel */
	.milestone-edit-panel {
		padding: 1rem;
	}

	.milestone-edit-panel form {
		margin: 0;
	}

	.edit-form-grid {
		display: grid;
		grid-template-columns: 1fr 2fr 1fr;
		gap: 0.75rem;
		margin: 0 0 0.75rem 0;
	}

	.edit-form-grid .form-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.edit-form-grid .form-field.full-width {
		grid-column: 1 / -1;
	}

	.edit-form-grid label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.edit-media-section {
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--color-border);
	}

	.edit-media-section h4 {
		font-size: 0.875rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
		color: var(--color-text);
	}

	.no-media-hint {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
	}

	.edit-panel-footer {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.footer-buttons {
		display: flex;
		gap: 0.5rem;
	}

	/* Media section styles */

	.media-strip {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.media-thumb {
		position: relative;
		flex-shrink: 0;
		width: 80px;
		height: 80px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--color-bg-elevated);
		cursor: grab;
		transition: transform 0.15s, opacity 0.15s, box-shadow 0.15s;
	}
	
	.media-thumb:active {
		cursor: grabbing;
	}
	
	.media-thumb.dragging {
		opacity: 0.5;
		transform: scale(0.95);
	}
	
	.media-thumb.drag-over {
		box-shadow: 0 0 0 2px var(--color-primary);
		transform: scale(1.05);
	}
	
	.drag-handle {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		border-radius: 3px;
		font-size: 0.625rem;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.15s;
		pointer-events: none;
		letter-spacing: -1px;
	}
	
	.media-thumb:hover .drag-handle {
		opacity: 1;
	}

	/* Show drag handle on touch devices */
	@media (hover: none) and (pointer: coarse) {
		.drag-handle {
			opacity: 0.7;
		}
		
		.media-thumb {
			touch-action: none;
		}
	}
	
	.reorder-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.media-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.delete-media-form {
		position: absolute;
		top: 2px;
		right: 2px;
	}

	.media-delete-btn {
		width: 20px;
		height: 20px;
		border: none;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		border-radius: 50%;
		cursor: pointer;
		font-size: 0.75rem;
		line-height: 1;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.media-thumb:hover .media-delete-btn {
		opacity: 1;
	}

	.media-delete-btn:hover {
		background: var(--color-error);
	}

	.add-media-btn {
		padding: 0.5rem 1rem;
		background: transparent;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.875rem;
	}

	.add-media-btn:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	/* Meta section styles */
	.edit-meta-section {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	.edit-meta-section h4 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.meta-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		align-items: center;
	}

	.meta-row select {
		min-width: 140px;
		padding: 0.375rem 0.5rem;
		font-size: 0.8125rem;
	}

	.meta-row input {
		flex: 1;
		min-width: 80px;
		padding: 0.375rem 0.5rem;
		font-size: 0.8125rem;
	}

	.meta-row .icon-field {
		flex: 0;
		width: 50px;
		text-align: center;
	}

	.meta-remove-btn {
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
	}

	.meta-remove-btn:hover {
		background: var(--color-error);
		color: white;
	}

	.add-meta-btn {
		padding: 0.375rem 0.75rem;
		background: transparent;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.8125rem;
	}

	.add-meta-btn:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.uploader-section {
		margin-top: 0.5rem;
		padding: 1rem;
		background: var(--color-bg);
		border-radius: var(--radius-md);
	}

	.uploader-section .btn-small-secondary {
		margin-top: 0.75rem;
	}
	
	.upload-success-msg {
		background: rgba(34, 197, 94, 0.1);
		color: var(--color-success);
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		margin-bottom: 0.75rem;
		text-align: center;
	}

	.add-media-inline {
		margin-top: 0.5rem;
	}

	.media-form-fields {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.media-form-fields select,
	.media-form-fields input {
		padding: 0.375rem 0.5rem;
		font-size: 0.8125rem;
		flex: 1;
		min-width: 100px;
	}

	.media-form-fields select {
		flex: 0;
		min-width: 80px;
	}

	.btn-small-primary {
		padding: 0.375rem 0.75rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 0.8125rem;
	}

	.btn-small-secondary {
		padding: 0.375rem 0.75rem;
		background: transparent;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 0.8125rem;
	}

	.milestone-edit-form {
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
	}

	.empty-state {
		text-align: center;
		padding: 3rem;
		color: var(--color-text-muted);
		background: var(--color-bg-elevated);
		border-radius: var(--radius-md);
	}

	.inline {
		display: inline;
	}

	/* Mobile styles */
	@media (max-width: 768px) {
		.entries-page h1 {
			font-size: 1.25rem;
		}

		.add-segment-form {
			flex-direction: column;
			align-items: stretch;
		}

		.add-segment-form .icon-input {
			width: 100%;
		}

		.form-field,
		.form-field.full-width {
			min-width: 100%;
		}

		.btn-primary,
		.btn-secondary {
			width: 100%;
			text-align: center;
		}

		.segment-header {
			flex-wrap: wrap;
			gap: 0.5rem;
		}

		.segment-count {
			margin-left: 0;
			width: 100%;
			order: 3;
		}

		.milestone-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}

		.milestone-row-wrapper {
			flex-direction: row;
		}

		.drag-handle-milestone {
			padding: 0.75rem;
			font-size: 1.25rem;
			opacity: 0.7;
			touch-action: none;
		}

		.milestone-date {
			min-width: auto;
		}

		.edit-form-grid {
			grid-template-columns: 1fr;
		}

		.empty-state {
			padding: 2rem 1rem;
		}

		/* Mobile media styles */
		.media-thumb {
			width: 60px;
			height: 60px;
		}

		.media-delete-btn {
			opacity: 1;
		}

		.media-form-fields {
			flex-direction: column;
		}

		.media-form-fields select,
		.media-form-fields input {
			min-width: 100%;
		}

		.btn-small-primary,
		.btn-small-secondary {
			width: 100%;
		}
	}

	/* Global styles for touch drag clone (appended to body) */
	:global(.touch-drag-clone) {
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--color-bg-elevated);
	}

	:global(.touch-drag-clone img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	:global(.touch-drag-clone .drag-handle),
	:global(.touch-drag-clone .delete-media-form) {
		display: none;
	}

	/* Global styles for milestone touch drag clone */
	:global(.touch-milestone-drag-clone) {
		border-radius: var(--radius-md);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
	}

	:global(.touch-milestone-drag-clone .drag-handle-milestone) {
		display: none;
	}
</style>
