import { deleteCard, getCard } from "@/server/cards";
import { handleError, HttpError, json, owner, recordId, verifyOrigin } from "@/server/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const card = await getCard(
      await owner(request),
      recordId((await context.params).id),
    );
    if (!card) throw new HttpError(404, "Card not found.");
    return json({ card });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    verifyOrigin(request);
    const deleted = await deleteCard(
      await owner(request),
      recordId((await context.params).id),
    );
    if (!deleted) throw new HttpError(404, "Card not found.");
    return json({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
