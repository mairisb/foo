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
    const card = await readCardUpload(request, (input, images) => createCard(ownerId, input, images));
    return json({ card }, 201);
  } catch (error) {
    return handleError(error);
  }
}
