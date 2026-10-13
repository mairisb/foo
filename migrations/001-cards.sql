CREATE TABLE cards (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  label varchar(80) NOT NULL,
  issuer varchar(80) NOT NULL,
  card_number varchar(128) NOT NULL,
  barcode_payload varchar(512) NOT NULL,
  barcode_format text NOT NULL CHECK (barcode_format IN ('code128','ean13','qrcode')),
  color text NOT NULL CHECK (color IN ('mint','peach','lavender','sky','sand','rose')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cards_owner_created_idx ON cards(owner_id,created_at DESC);
CREATE TABLE share_links (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_links_card_idx ON share_links(card_id);
