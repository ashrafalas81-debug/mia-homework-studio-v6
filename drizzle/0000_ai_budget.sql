CREATE TABLE mia_ai_budget (
  scope TEXT PRIMARY KEY NOT NULL,
  reserved_microusd INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE mia_ai_quota (
  actor_day TEXT PRIMARY KEY NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0
);
