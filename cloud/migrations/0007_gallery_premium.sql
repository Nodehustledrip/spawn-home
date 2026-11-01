-- Premium templates: included with Pro today. access='pro' means a signed-in Pro account can remix it.
-- price_cents is reserved for a possible one-off purchase later (NULL = not sold separately).
ALTER TABLE gallery ADD COLUMN premium INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gallery ADD COLUMN access TEXT NOT NULL DEFAULT 'open';
ALTER TABLE gallery ADD COLUMN price_cents INTEGER;
