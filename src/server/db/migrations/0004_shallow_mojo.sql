CREATE TABLE `mp_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`result` text DEFAULT '{}' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_jobs_status` ON `mp_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `mp_jobs_project` ON `mp_jobs` (`project_id`);