import "server-only";
import { randomUUID } from "node:crypto";
import type { Card, CardInput, BarcodeFormat } from "@/lib/cards";
import { db } from "./db";

type CardRow = {
  id: string;
  label: string;
  card_number: string | null;
  barcode_format: BarcodeFormat | null;
  image_count: number;
  created_at: Date;
};
const toCard = (row: CardRow): Card => ({
  id: row.id,
  label: row.label,
  imageCount: row.image_count,
  ...(row.card_number !== null && row.barcode_format !== null
    ? { cardNumber: row.card_number, barcodeFormat: row.barcode_format }
    : {}),
  createdAt: row.created_at.toISOString(),
});

const cardColumns = `c.id, c.label, c.card_number, c.barcode_format, c.created_at,
  (SELECT count(*)::int FROM card_images i WHERE i.card_id=c.id) AS image_count`;

export async function listCards(ownerId: string) {
  const result = await db.query<CardRow>(
    `SELECT ${cardColumns} FROM cards c WHERE c.owner_id=$1 ORDER BY c.created_at DESC`,
    [ownerId],
  );
  return result.rows.map(toCard);
}
export async function getCard(ownerId: string, id: string) {
  const result = await db.query<CardRow>(
    `SELECT ${cardColumns} FROM cards c WHERE c.owner_id=$1 AND c.id=$2`,
    [ownerId, id],
  );
  return result.rows[0] ? toCard(result.rows[0]) : null;
}
export async function deleteCard(ownerId: string, id: string) {
  const result = await db.query(
    "DELETE FROM cards WHERE owner_id=$1 AND id=$2 RETURNING id",
    [ownerId, id],
  );
  return result.rows.length > 0;
}
export async function createCard(ownerId: string, input: CardInput, images: AsyncIterable<Buffer>) {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    const result = await connection.query<CardRow>(
      "INSERT INTO cards (id,owner_id,label) VALUES ($1,$2,$3) RETURNING *",
      [randomUUID(), ownerId, input.label],
    );
    const row = result.rows[0];
    let imageCount = 0;
    for await (const image of images) {
      imageCount++;
      await connection.query(
        "INSERT INTO card_images (card_id,position,data) VALUES ($1,$2,$3)",
        [row.id, imageCount, image],
      );
    }
    await connection.query("COMMIT");
    return toCard({ ...row, image_count: imageCount });
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

export async function getCardImage(ownerId: string, id: string, position: number) {
  const result = await db.query<{ data: Buffer }>(
    `SELECT i.data FROM card_images i JOIN cards c ON c.id=i.card_id
     WHERE c.owner_id=$1 AND c.id=$2 AND i.position=$3`,
    [ownerId, id, position],
  );
  return result.rows[0]?.data ?? null;
}
