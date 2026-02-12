CREATE TABLE `notification_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`group_key` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`send_after` integer NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `milestone` ADD `notified_at` integer;--> statement-breakpoint
ALTER TABLE `user_profile` ADD `notification_preferences` text DEFAULT '{"new_milestones":true}';