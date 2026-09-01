CREATE TABLE `mp_scheduled_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`platform` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`origin` text DEFAULT 'scheduled' NOT NULL,
	`provider_ref` text,
	`external_url` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`posted_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `mp_content_pieces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_scheduled_status` ON `mp_scheduled_posts` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `mp_scheduled_project` ON `mp_scheduled_posts` (`project_id`);