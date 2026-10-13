-- The initial iteration keeps account-owned cards and barcode display only.
-- Existing authentication accounts are preserved.
DROP TABLE share_links;
ALTER TABLE cards
  DROP COLUMN issuer,
  DROP COLUMN barcode_payload,
  DROP COLUMN color,
  DROP COLUMN updated_at;
