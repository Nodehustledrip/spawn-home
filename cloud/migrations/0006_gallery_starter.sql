-- Marks gallery entries published by Spawn itself as starter templates ("Spawn starter" label).
ALTER TABLE gallery ADD COLUMN starter INTEGER NOT NULL DEFAULT 0;
