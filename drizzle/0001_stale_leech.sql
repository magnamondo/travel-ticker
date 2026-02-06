ALTER TABLE `milestone` ADD `meta` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `milestone` DROP COLUMN `location`;--> statement-breakpoint
ALTER TABLE `milestone` DROP COLUMN `coordinates`;