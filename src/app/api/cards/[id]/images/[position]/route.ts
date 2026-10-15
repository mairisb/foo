import { getCardImage } from "@/server/cards";
import { handleError, HttpError, owner, recordId } from "@/server/http";

export async function GET(
    request: Request,
    context: { params: Promise<{ id: string; position: string }> },
) {
    try {
        const ownerId = await owner(request);
        const { id, position } = await context.params;
        if (!/^[1-9]\d*$/.test(position) || Number(position) > 2147483647) {
            throw new HttpError(404, "Image not found.");
        }
        const data = await getCardImage(
            ownerId,
            recordId(id),
            Number(position),
        );
        if (!data) {
            throw new HttpError(404, "Image not found.");
        }
        return new Response(new Uint8Array(data), {
            headers: {
                "Content-Type": "image/jpeg",
                "Content-Disposition": 'inline; filename="card-image.jpg"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'",
            },
        });
    } catch (error) {
        return handleError(error);
    }
}
