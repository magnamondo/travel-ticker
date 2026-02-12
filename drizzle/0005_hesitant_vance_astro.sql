ALTER TABLE `comment` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `comment` ADD `is_hidden` integer DEFAULT false NOT NULL;