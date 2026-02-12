/**
 * Notification Type Definitions
 * 
 * These are defined in code rather than database since:
 * - Adding/removing types requires code changes anyway (email templates, queue calls)
 * - This simplifies the schema and avoids seeding
 */

export interface NotificationPreferences {
	new_milestones?: boolean;
}

export const NOTIFICATION_TYPES = [
	{
		id: 'new_milestones',
		label: 'New Milestones',
		description: 'Get notified when new milestones are published'
	}
] as const;

export type NotificationTypeId = typeof NOTIFICATION_TYPES[number]['id'];

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
	new_milestones: true
};
