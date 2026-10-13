import "server-only";
import { z } from "zod";
import { auth } from "./auth";
import { getAppOrigins } from "./origins";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export function handleError(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json(
      { error: error.issues[0]?.message ?? "Check the entered values." },
      400,
    );
  if (error instanceof SyntaxError)
    return json({ error: "Invalid request body." }, 400);
  // Do not log request data, share tokens, or card identifiers.
  console.error(
    "Request failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return json({ error: "Something went wrong. Please try again." }, 500);
}
export async function owner(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "Please sign in to continue.");
  return session.user.id;
}
export function verifyOrigin(request: Request) {
  if (!getAppOrigins().includes(request.headers.get("origin") ?? ""))
    throw new HttpError(403, "Request origin is not allowed.");
}
export const recordId = (value: string) => z.uuid().parse(value);
