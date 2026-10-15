import { betterAuth } from "better-auth";
import { db } from "./db";
import { getAppOrigins } from "./origins";

export const auth = betterAuth({
    appName: "foo",
    database: db,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: getAppOrigins(),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 12,
        maxPasswordLength: 128,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
});
