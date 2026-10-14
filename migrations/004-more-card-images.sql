-- Keep existing image order and data while removing the two-image restriction.
ALTER TABLE card_images DROP CONSTRAINT card_images_position_check;
ALTER TABLE card_images ALTER COLUMN position TYPE integer;
ALTER TABLE card_images ADD CONSTRAINT card_images_position_check CHECK (position > 0);
