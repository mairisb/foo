import { createCard, listCards } from "@/server/cards";
import { readCardUpload } from "@/server/uploads";
import {
  handleError,
  json,
  owner,
  verifyOrigin,
} from "@/server/http";

export async function GET(request: Request) {
  try {
    return json({ cards: await listCards(await owner(request)) });
  } catch (error) {
    return handleError(error);
  }
}
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ownerId = await owner(request);
    const { input, images } = await readCardUpload(request);
    return json({ card: await createCard(ownerId, input, images) }, 201);
  } catch (error) {
    return handleError(error);
  }
}
