-- New cards use a name and zero, one, or two images. Preserve old card data.
ALTER TABLE cards
  ALTER COLUMN card_number DROP NOT NULL,
  ALTER COLUMN barcode_format DROP NOT NULL;

CREATE TABLE card_images (
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 2),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 3145728),
  PRIMARY KEY (card_id, position)
);
