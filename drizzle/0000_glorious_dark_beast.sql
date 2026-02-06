CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`user_id` text,
	`author_name` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestone`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `milestone` (
	`id` text PRIMARY KEY NOT NULL,
	`segment_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`date` integer NOT NULL,
	`avatar` text,
	`location` text,
	`coordinates` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `milestone_media` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`thumbnail_url` text,
	`caption` text,
	`duration` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestone`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reaction` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`milestone_id` text,
	`comment_id` text,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestone`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `segment` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `upload_session` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`file_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`chunk_size` integer NOT NULL,
	`total_chunks` integer NOT NULL,
	`uploaded_chunks` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`file_path` text,
	`milestone_id` text,
	`checksum` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestone`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`roles` text DEFAULT '[]' NOT NULL,
	`verification_token` text,
	`reset_password_token` text,
	`reset_password_expires` integer,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`first_name` text,
	`last_name` text,
	`date_of_birth` integer,
	`phone_number` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_user_id_unique` ON `user_profile` (`user_id`);