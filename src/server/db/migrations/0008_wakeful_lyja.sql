CREATE TABLE `mp_shortlinks` (
	`code` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`piece_id` text,
	`target` text NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`last_click_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `mp_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `mp_content_pieces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mp_shortlinks_piece` ON `mp_shortlinks` (`piece_id`);