CREATE TABLE `ticker` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tagline` text,
	`description` text,
	`origin_label` text,
	`destination_label` text,
	`cover_image` text,
	`published` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticker_slug_unique` ON `ticker` (`slug`);--> statement-breakpoint
INSERT INTO `ticker` (
	`id`, `slug`, `name`, `tagline`, `description`,
	`origin_label`, `destination_label`, `cover_image`,
	`published`, `sort_order`, `created_at`
)
SELECT
	'tkr_toulouse_lome',
	'toulouse-lome',
	'Africa Westcoast',
	'Travel Ticker',
	'Follow along on my adventure from Toulouse to Lomé',
	'Toulouse',
	'Lomé',
	NULL,
	1,
	0,
	CAST(strftime('%s', 'now') AS INTEGER)
WHERE EXISTS (SELECT 1 FROM `segment`);--> statement-breakpoint
-- defer_foreign_keys works inside the migrator's transaction (foreign_keys does not);
-- it lets us drop/rebuild `segment` while `milestone` still references it.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_segment` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticker_id`) REFERENCES `ticker`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_segment` (`id`, `ticker_id`, `name`, `icon`, `sort_order`, `created_at`)
SELECT `id`, 'tkr_toulouse_lome', `name`, `icon`, `sort_order`, `created_at` FROM `segment`;--> statement-breakpoint
DROP TABLE `segment`;--> statement-breakpoint
ALTER TABLE `__new_segment` RENAME TO `segment`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
