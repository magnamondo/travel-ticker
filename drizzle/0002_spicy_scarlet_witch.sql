CREATE TABLE `video_job` (
	`id` text PRIMARY KEY NOT NULL,
	`input_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`filename` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`result_url` text,
	`thumbnail_url` text,
	`duration` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
ALTER TABLE `milestone` ADD `published` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `milestone_media` ADD `video_job_id` text REFERENCES video_job(id);