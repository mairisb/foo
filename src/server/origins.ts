export function getAppOrigins(
  baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  environment = process.env.NODE_ENV,
  developmentOrigin = process.env.DEV_APP_ORIGIN ?? "",
): string[] {
  const configured = new URL(baseURL);
  const origins = new Set([configured.origin]);

  // next dev prints 127.0.0.1, while local setup uses localhost. Trust the
  // two loopback names on the configured port only during development.
  if (
    environment === "development" &&
    ["localhost", "127.0.0.1"].includes(configured.hostname)
  ) {
    for (const hostname of ["localhost", "127.0.0.1"]) {
      const alias = new URL(configured.origin);
      alias.hostname = hostname;
      origins.add(alias.origin);
    }
  }

  if (environment === "development" && developmentOrigin) {
    origins.add(new URL(developmentOrigin).origin);
  }

  return [...origins];
}
