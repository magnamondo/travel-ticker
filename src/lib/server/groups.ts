import { eq, and, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { isAdmin } from '$lib/roles';

/**
 * Get all groups a user belongs to
 */
export async function getUserGroups(userId: string): Promise<table.Group[]> {
	const results = await db
		.select({ group: table.group })
		.from(table.userGroup)
		.innerJoin(table.group, eq(table.userGroup.groupId, table.group.id))
		.where(eq(table.userGroup.userId, userId));
	
	return results.map(r => r.group);
}

/**
 * Get group IDs for a user (useful for filtering)
 */
export async function getUserGroupIds(userId: string): Promise<string[]> {
	const results = await db
		.select({ groupId: table.userGroup.groupId })
		.from(table.userGroup)
		.where(eq(table.userGroup.userId, userId));
	
	return results.map(r => r.groupId);
}

/**
 * Check if a user is in a specific group
 */
export async function isUserInGroup(userId: string, groupId: string): Promise<boolean> {
	const [result] = await db
		.select({ id: table.userGroup.id })
		.from(table.userGroup)
		.where(and(
			eq(table.userGroup.userId, userId),
			eq(table.userGroup.groupId, groupId)
		))
		.limit(1);
	
	return !!result;
}

/**
 * Check if user is in any of the given groups
 */
export async function isUserInAnyGroup(userId: string, groupIds: string[]): Promise<boolean> {
	if (groupIds.length === 0) return false;
	
	const [result] = await db
		.select({ id: table.userGroup.id })
		.from(table.userGroup)
		.where(and(
			eq(table.userGroup.userId, userId),
			inArray(table.userGroup.groupId, groupIds)
		))
		.limit(1);
	
	return !!result;
}

/**
 * Get group IDs for a milestone
 */
export async function getMilestoneGroupIds(milestoneId: string): Promise<string[]> {
	const results = await db
		.select({ groupId: table.milestoneGroup.groupId })
		.from(table.milestoneGroup)
		.where(eq(table.milestoneGroup.milestoneId, milestoneId));
	
	return results.map(r => r.groupId);
}

/**
 * Check if user can access a milestone
 * - Admins can access all milestones
 * - No groups assigned = public (everyone can see)
 * - Has groups = only users in those groups can see
 */
export async function canUserAccessMilestone(
	userId: string | null,
	milestoneId: string,
	userRoles?: string[]
): Promise<boolean> {
	// Admins can access everything
	if (userRoles && isAdmin(userRoles)) {
		return true;
	}

	const groupIds = await getMilestoneGroupIds(milestoneId);
	
	// No groups = public
	if (groupIds.length === 0) {
		return true;
	}
	
	// Must be logged in to access group-restricted milestones
	if (!userId) {
		return false;
	}
	
	return isUserInAnyGroup(userId, groupIds);
}

/**
 * Get all accessible milestone IDs for a user
 * Returns IDs of:
 * 1. All public milestones (no groups assigned)
 * 2. Milestones in groups the user belongs to
 */
export async function getAccessibleMilestoneFilter(userId: string | null): Promise<{
	publicMilestoneIds: string[];
	userGroupIds: string[];
}> {
	// Get milestone IDs that have group restrictions
	const restrictedMilestones = await db
		.select({ milestoneId: table.milestoneGroup.milestoneId })
		.from(table.milestoneGroup);
	
	const restrictedMilestoneIds = [...new Set(restrictedMilestones.map(m => m.milestoneId))];
	
	// Get user's group IDs if logged in
	const userGroupIds = userId ? await getUserGroupIds(userId) : [];
	
	return {
		publicMilestoneIds: restrictedMilestoneIds, // These are the ones to exclude unless user has access
		userGroupIds
	};
}

/**
 * Add a user to a group
 */
export async function addUserToGroup(
	userId: string, 
	groupId: string, 
	role: 'member' | 'admin' = 'member'
): Promise<void> {
	const id = crypto.randomUUID();
	await db.insert(table.userGroup).values({
		id,
		userId,
		groupId,
		role,
		joinedAt: new Date()
	});
}

/**
 * Remove a user from a group
 */
export async function removeUserFromGroup(userId: string, groupId: string): Promise<void> {
	await db
		.delete(table.userGroup)
		.where(and(
			eq(table.userGroup.userId, userId),
			eq(table.userGroup.groupId, groupId)
		));
}

/**
 * Get all members of a group
 */
export async function getGroupMembers(groupId: string): Promise<Array<{
	user: { id: string; email: string };
	role: string;
	joinedAt: Date;
}>> {
	const results = await db
		.select({
			user: { id: table.user.id, email: table.user.email },
			role: table.userGroup.role,
			joinedAt: table.userGroup.joinedAt
		})
		.from(table.userGroup)
		.innerJoin(table.user, eq(table.userGroup.userId, table.user.id))
		.where(eq(table.userGroup.groupId, groupId));
	
	return results;
}

/**
 * Create a new group
 */
export async function createGroup(name: string, description?: string): Promise<table.Group> {
	const id = crypto.randomUUID();
	const group: table.Group = {
		id,
		name,
		description: description ?? null,
		createdAt: new Date()
	};
	await db.insert(table.group).values(group);
	return group;
}

/**
 * Get all groups
 */
export async function getAllGroups(): Promise<table.Group[]> {
	return db.select().from(table.group).orderBy(table.group.name);
}

/**
 * Get a group by ID
 */
export async function getGroupById(id: string): Promise<table.Group | null> {
	const [result] = await db
		.select()
		.from(table.group)
		.where(eq(table.group.id, id))
		.limit(1);
	return result ?? null;
}

/**
 * Update a group
 */
export async function updateGroup(id: string, data: { name?: string; description?: string }): Promise<void> {
	await db.update(table.group).set(data).where(eq(table.group.id, id));
}

/**
 * Delete a group
 */
export async function deleteGroup(id: string): Promise<void> {
	await db.delete(table.group).where(eq(table.group.id, id));
}
