CREATE TABLE `mp_kanal_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`platform` text NOT NULL,
	`tag` text NOT NULL,
	`werte` text DEFAULT '{}' NOT NULL,
	`quelle` text DEFAULT 'api' NOT NULL,
	`abgerufen_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_kanal_stats_key` ON `mp_kanal_stats` (`project_id`,`platform`,`tag`);--> statement-breakpoint
CREATE INDEX `mp_kanal_stats_tag` ON `mp_kanal_stats` (`tag`);--> statement-breakpoint
CREATE TABLE `mp_klick_tage` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`piece_id` text,
	`code` text NOT NULL,
	`tag` text NOT NULL,
	`klicks` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mp_klick_tage_key` ON `mp_klick_tage` (`project_id`,`tag`);--> statement-breakpoint
CREATE INDEX `mp_klick_tage_code` ON `mp_klick_tage` (`code`,`tag`);--> statement-breakpoint
CREATE TABLE `mp_post_verlauf` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`gemessen_am` text NOT NULL,
	`werte` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `mp_scheduled_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_post_verlauf_post` ON `mp_post_verlauf` (`post_id`,`gemessen_am`);