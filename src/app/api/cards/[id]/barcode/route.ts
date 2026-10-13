import { getCard } from "@/server/cards";
import { barcodeSvg } from "@/server/barcodes";
import { handleError, HttpError, owner, recordId } from "@/server/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const card = await getCard(
      await owner(request),
      recordId((await context.params).id),
    );
    if (!card || !card.barcodeFormat || !card.cardNumber) throw new HttpError(404, "Card not found.");
    return new Response(barcodeSvg(card.barcodeFormat, card.cardNumber), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
