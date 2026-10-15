import "server-only";
import { randomUUID } from "node:crypto";
import type {
    Card,
    CardInput,
    CardEditInput,
    BarcodeFormat,
} from "@/lib/cards";
import { db } from "./db";
import { HttpError } from "./http";
import { prepareCardImage } from "./images";

type CardRow = {
    id: string;
    label: string;
    card_number: string | null;
    barcode_format: BarcodeFormat | null;
    image_count: number;
    created_at: Date;
    revision: number;
};
const toCard = (row: CardRow): Card => ({
    id: row.id,
    label: row.label,
    imageCount: row.image_count,
    revision: row.revision,
    ...(row.card_number !== null && row.barcode_format !== null
        ? { cardNumber: row.card_number, barcodeFormat: row.barcode_format }
        : {}),
    createdAt: row.created_at.toISOString(),
});

const cardColumns = `c.id, c.label, c.card_number, c.barcode_format, c.created_at, c.revision,
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
export async function createCard(
    ownerId: string,
    input: CardInput,
    images: AsyncIterable<Buffer>,
) {
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

export async function updateCard(
    ownerId: string,
    id: string,
    input: CardEditInput,
    images: AsyncIterable<Buffer>,
) {
    const connection = await db.connect();
    try {
        await connection.query("BEGIN");
        const current = await connection.query<CardRow>(
            `SELECT ${cardColumns} FROM cards c WHERE c.owner_id=$1 AND c.id=$2 FOR UPDATE OF c`,
            [ownerId, id],
        );
        const row = current.rows[0];
        if (!row) {
            throw new HttpError(404, "Card not found.");
        }
        if (row.revision !== input.revision) {
            throw new HttpError(
                409,
                "This card changed. Close and reopen the editor before saving.",
            );
        }
        let imageCount = row.image_count;
        const rotations = input.rotateImages ?? [];
        const removedPositions = new Set(input.removeImages);
        if (
            rotations.some(
                (image) =>
                    image.position > imageCount ||
                    removedPositions.has(image.position),
            )
        ) {
            throw new HttpError(
                400,
                "Choose a saved image that isn't being removed.",
            );
        }
        for (const image of rotations) {
            if (image.rotation === 0) {
                continue;
            }
            const saved = await connection.query<{ data: Buffer }>(
                "SELECT data FROM card_images WHERE card_id=$1 AND position=$2",
                [id, image.position],
            );
            if (!saved.rows[0]) {
                throw new HttpError(400, "Image not found.");
            }
            const data = await prepareCardImage(
                saved.rows[0].data,
                image.rotation,
            );
            await connection.query(
                "UPDATE card_images SET data=$3 WHERE card_id=$1 AND position=$2",
                [id, image.position, data],
            );
        }
        if (input.removeImages.length > 0) {
            const removed = await connection.query(
                "SELECT position FROM card_images WHERE card_id=$1 AND position=ANY($2::int[])",
                [id, input.removeImages],
            );
            if (removed.rows.length !== input.removeImages.length) {
                throw new HttpError(400, "Image not found.");
            }
            // Rebuild the retained sequence inside the database without copying image
            // bytes into the application or colliding with the original positions.
            await connection.query(
                `WITH previous AS (
          DELETE FROM card_images WHERE card_id=$1 RETURNING position, data
        )
        INSERT INTO card_images (card_id,position,data)
        SELECT $1, row_number() OVER (ORDER BY position)::int, data
        FROM previous WHERE NOT (position=ANY($2::int[]))`,
                [id, input.removeImages],
            );
            imageCount -= input.removeImages.length;
        }
        const retainedCount = imageCount;
        for await (const image of images) {
            imageCount++;
            await connection.query(
                "INSERT INTO card_images (card_id,position,data) VALUES ($1,$2,$3)",
                [id, imageCount, image],
            );
        }
        if (input.imageOrder !== undefined) {
            if (
                input.imageOrder.length !== retainedCount ||
                input.imageOrder.some((position) => position > imageCount)
            ) {
                throw new HttpError(400, "Invalid image order.");
            }
            const order: number[] = new Array(imageCount);
            for (const [index, destination] of input.imageOrder.entries()) {
                order[destination - 1] = index + 1;
            }
            let nextNewImage = retainedCount + 1;
            for (let index = 0; index < order.length; index++) {
                if (order[index] === undefined) {
                    order[index] = nextNewImage++;
                }
            }
            if (order.some((position, index) => position !== index + 1)) {
                // Exhaust DELETE RETURNING before reusing any positions; a join alone
                // can otherwise insert while another original position still exists.
                // Image bytes remain inside PostgreSQL and are never re-encoded.
                await connection.query(
                    `WITH previous AS (
            DELETE FROM card_images WHERE card_id=$1 RETURNING position, data
          )
          INSERT INTO card_images (card_id,position,data)
          SELECT $1, desired.ordinality::int, previous.data
          FROM unnest($2::int[]) WITH ORDINALITY AS desired(position, ordinality)
          JOIN previous ON previous.position=desired.position
          WHERE (SELECT count(*) FROM previous) > 0`,
                    [id, order],
                );
            }
        }
        const result = await connection.query<CardRow>(
            "UPDATE cards SET label=$3, revision=revision+1 WHERE owner_id=$1 AND id=$2 RETURNING *",
            [ownerId, id, input.label],
        );
        await connection.query("COMMIT");
        return toCard({ ...result.rows[0], image_count: imageCount });
    } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
    } finally {
        connection.release();
    }
}

export async function getCardImage(
    ownerId: string,
    id: string,
    position: number,
) {
    const result = await db.query<{ data: Buffer }>(
        `SELECT i.data FROM card_images i JOIN cards c ON c.id=i.card_id
     WHERE c.owner_id=$1 AND c.id=$2 AND i.position=$3`,
        [ownerId, id, position],
    );
    return result.rows[0]?.data ?? null;
}
