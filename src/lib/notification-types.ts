/**
 * Notification Type Definitions
 * 
 * These are defined in code rather than database since:
 * - Adding/removing types requires code changes anyway (email templates, queue calls)
 * - This simplifies the schema and avoids seeding
 */

export interface NotificationPreferences {
	new_milestones?: boolean;
	comment_replies?: boolean;
	comment_reactions?: boolean;
}

export const NOTIFICATION_TYPES = [
	{
		id: 'new_milestones',
		label: 'New Milestones',
		description: 'Get notified when new milestones are published'
	},
	{
		id: 'comment_replies',
		label: 'Comment Replies',
		description: 'Get notified when someone comments on a milestone you\'ve commented on'
	},
	{
		id: 'comment_reactions',
		label: 'Comment Reactions',
		description: 'Get notified when someone reacts to your comment'
	}
] as const;

export type NotificationTypeId = typeof NOTIFICATION_TYPES[number]['id'];

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
	new_milestones: true,
	comment_replies: false,
	comment_reactions: false
};
