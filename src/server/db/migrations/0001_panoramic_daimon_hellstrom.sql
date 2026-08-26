CREATE TABLE `mp_analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`error` text,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_analysis_project` ON `mp_analysis_runs` (`project_id`);--> statement-breakpoint
CREATE TABLE `mp_competitors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`positioning` text DEFAULT '' NOT NULL,
	`pricing` text DEFAULT '' NOT NULL,
	`complaints` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_competitors_project` ON `mp_competitors` (`project_id`);--> statement-breakpoint
CREATE TABLE `mp_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`status` integer DEFAULT 0 NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_pages_project` ON `mp_pages` (`project_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mp_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`content_piece_id` text,
	`project_id` text,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`content_piece_id`) REFERENCES `mp_content_pieces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_mp_assets`("id", "content_piece_id", "project_id", "kind", "path", "meta", "created_at") SELECT "id", "content_piece_id", NULL, "kind", "path", "meta", "created_at" FROM `mp_assets`;--> statement-breakpoint
DROP TABLE `mp_assets`;--> statement-breakpoint
ALTER TABLE `__new_mp_assets` RENAME TO `mp_assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mp_assets_piece` ON `mp_assets` (`content_piece_id`);--> statement-breakpoint
CREATE INDEX `mp_assets_project` ON `mp_assets` (`project_id`);--> statement-breakpoint
ALTER TABLE `mp_channels` ADD `meta` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_geo_snapshots` ADD `batch` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `mp_geo_batch` ON `mp_geo_snapshots` (`batch`);--> statement-breakpoint
ALTER TABLE `mp_personas` ADD `phrases` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_personas` ADD `objections` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_personas` ADD `buying_triggers` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_personas` ADD `evidence` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_projects` ADD `brief_meta` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `mp_projects` ADD `brief_markdown` text DEFAULT '' NOT NULL;