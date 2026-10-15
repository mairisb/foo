-- A revision prevents an older edit from replacing newer card changes.
ALTER TABLE cards ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0);
