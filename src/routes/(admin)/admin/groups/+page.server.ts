import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { group, userGroup, user, segment, milestone, milestoneGroup } from '$lib/server/db/schema';
import { desc, eq, count, sql, and, inArray } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { randomUUID } from 'crypto';

export const load: PageServerLoad = async () => {
	// Get groups with member counts and milestone counts
	const groups = await db
		.select({
			id: group.id,
			name: group.name,
			description: group.description,
			createdAt: group.createdAt,
			memberCount: sql<number>`(SELECT COUNT(*) FROM user_group WHERE user_group.group_id = "group".id)`,
			milestoneCount: sql<number>`(SELECT COUNT(*) FROM milestone_group WHERE milestone_group.group_id = "group".id)`
		})
		.from(group)
		.orderBy(group.name);

	// Get users for the add member dropdown
	const users = await db
		.select({
			id: user.id,
			email: user.email
		})
		.from(user)
		.orderBy(user.email);

	// Get milestones with their segment names
	const milestones = await db
		.select({
			id: milestone.id,
			title: milestone.title,
			segmentId: milestone.segmentId,
			segmentName: segment.name
		})
		.from(milestone)
		.innerJoin(segment, eq(milestone.segmentId, segment.id))
		.orderBy(segment.name, milestone.title);

	// Get milestone-group assignments
	const milestoneGroupAssignments = await db
		.select({
			milestoneId: milestoneGroup.milestoneId,
			groupId: milestoneGroup.groupId
		})
		.from(milestoneGroup);

	return {
		groups,
		users,
		milestones,
		milestoneGroupAssignments
	};
};

export const actions: Actions = {
	createGroup: async ({ request }) => {
		const formData = await request.formData();
		const name = (formData.get('name') as string)?.trim();
		const description = (formData.get('description') as string)?.trim() || null;

		if (!name) {
			return fail(400, { error: 'Group name is required' });
		}

		// Check if group already exists
		const existing = await db.select().from(group).where(eq(group.name, name));
		if (existing.length > 0) {
			return fail(400, { error: 'A group with this name already exists' });
		}

		await db.insert(group).values({
			id: randomUUID(),
			name,
			description,
			createdAt: new Date()
		});

		return { success: true, message: 'Group created successfully' };
	},

	updateGroup: async ({ request }) => {
		const formData = await request.formData();
		const groupId = formData.get('groupId') as string;
		const name = (formData.get('name') as string)?.trim();
		const description = (formData.get('description') as string)?.trim() || null;

		if (!groupId || !name) {
			return fail(400, { error: 'Group ID and name are required' });
		}

		// Check for duplicate name
		const existing = await db.select().from(group).where(eq(group.name, name));
		if (existing.length > 0 && existing[0].id !== groupId) {
			return fail(400, { error: 'Another group with this name already exists' });
		}

		await db.update(group)
			.set({ name, description })
			.where(eq(group.id, groupId));

		return { success: true, message: 'Group updated successfully' };
	},

	deleteGroup: async ({ request }) => {
		const formData = await request.formData();
		const groupId = formData.get('groupId') as string;

		if (!groupId) {
			return fail(400, { error: 'Group ID is required' });
		}

		// Cascade deletes will handle userGroup, segmentGroup, milestoneGroup
		await db.delete(group).where(eq(group.id, groupId));

		return { success: true, message: 'Group deleted successfully' };
	},

	addMember: async ({ request }) => {
		const formData = await request.formData();
		const groupId = formData.get('groupId') as string;
		const userId = formData.get('userId') as string;
		const role = (formData.get('role') as string) || 'member';

		if (!groupId || !userId) {
			return fail(400, { error: 'Group ID and User ID are required' });
		}

		// Check if already a member
		const existing = await db
			.select()
			.from(userGroup)
			.where(and(eq(userGroup.groupId, groupId), eq(userGroup.userId, userId)));
		
		if (existing.length > 0) {
			return fail(400, { error: 'User is already a member of this group' });
		}

		await db.insert(userGroup).values({
			id: randomUUID(),
			groupId,
			userId,
			role: role as 'member' | 'admin',
			joinedAt: new Date()
		});

		return { success: true, message: 'Member added successfully' };
	},

	removeMember: async ({ request }) => {
		const formData = await request.formData();
		const groupId = formData.get('groupId') as string;
		const userId = formData.get('userId') as string;

		if (!groupId || !userId) {
			return fail(400, { error: 'Group ID and User ID are required' });
		}

		await db.delete(userGroup)
			.where(and(eq(userGroup.groupId, groupId), eq(userGroup.userId, userId)));

		return { success: true, message: 'Member removed successfully' };
	},

	// Add a group to a milestone
	addMilestoneGroup: async ({ request }) => {
		const formData = await request.formData();
		const milestoneId = formData.get('milestoneId') as string;
		const groupId = formData.get('groupId') as string;

		if (!milestoneId || !groupId) {
			return fail(400, { error: 'Milestone ID and Group ID are required' });
		}

		// Check if already assigned
		const existing = await db
			.select()
			.from(milestoneGroup)
			.where(and(eq(milestoneGroup.milestoneId, milestoneId), eq(milestoneGroup.groupId, groupId)));
		
		if (existing.length > 0) {
			return fail(400, { error: 'Group already has access to this milestone' });
		}

		await db.insert(milestoneGroup).values({
			id: randomUUID(),
			milestoneId,
			groupId
		});

		return { success: true, message: 'Group added to milestone' };
	},

	// Remove a group from a milestone
	removeMilestoneGroup: async ({ request }) => {
		const formData = await request.formData();
		const milestoneId = formData.get('milestoneId') as string;
		const groupId = formData.get('groupId') as string;

		if (!milestoneId || !groupId) {
			return fail(400, { error: 'Milestone ID and Group ID are required' });
		}

		await db.delete(milestoneGroup)
			.where(and(eq(milestoneGroup.milestoneId, milestoneId), eq(milestoneGroup.groupId, groupId)));

		return { success: true, message: 'Group removed from milestone' };
	}
};
