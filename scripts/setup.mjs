import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env")) {
  console.log("Existing .env preserved.");
} else {
  writeFileSync(
    ".env",
    [
      "DATABASE_URL=postgresql://foo:foo_local@127.0.0.1:15432/foo",
      "BETTER_AUTH_URL=http://localhost:3000",
      `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log("Created local .env with a generated auth secret.");
}
