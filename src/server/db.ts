import { Pool, types } from "pg";

// PostgreSQL int8 defaults to a string. Better Auth normalizes bigint rate-limit
// timestamps; using that type prevents incorrect retry-after arithmetic.
types.setTypeParser(types.builtins.INT8, (value) => BigInt(value));

const globals = globalThis as unknown as { fooPool?: Pool };
export const db =
    globals.fooPool ??
    new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        connectionTimeoutMillis: 5000,
    });
if (process.env.NODE_ENV !== "production") {
    globals.fooPool = db;
}
