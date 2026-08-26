ALTER TABLE `mp_agent_runs` ADD `piece_id` text;--> statement-breakpoint
ALTER TABLE `mp_agent_runs` ADD `provider` text DEFAULT 'openrouter' NOT NULL;--> statement-breakpoint
CREATE INDEX `mp_runs_piece` ON `mp_agent_runs` (`piece_id`);