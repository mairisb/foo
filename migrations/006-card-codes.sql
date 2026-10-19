ALTER TABLE cards ADD COLUMN codes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(codes) = 'array' AND jsonb_array_length(codes) <= 64);
