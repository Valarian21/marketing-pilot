CREATE TABLE `mp_card_prices` (
	`card_id` text PRIMARY KEY NOT NULL,
	`eur` real,
	`eur_holo` real,
	`source` text DEFAULT 'tcgdex' NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mp_card_prices_fetched` ON `mp_card_prices` (`fetched_at`);