import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";

async function migrate() {
    const authMigration = await getMigrations(auth.options);
    await authMigration.runMigrations();
    console.log("Authentication schema is current.");
    const connection = await db.connect();
    try {
        await connection.query("BEGIN");
        await connection.query("SELECT pg_advisory_xact_lock(748219)");
        await connection.query(
            "CREATE TABLE IF NOT EXISTS foo_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
        );
        for (const name of (await readdir("migrations"))
            .filter((name) => name.endsWith(".sql"))
            .sort()) {
            const sql = await readFile(`migrations/${name}`, "utf8");
            const checksum = createHash("sha256").update(sql).digest("hex");
            const existing = await connection.query(
                "SELECT checksum FROM foo_schema_migrations WHERE name=$1",
                [name],
            );
            if (existing.rows.length) {
                if (existing.rows[0].checksum !== checksum) {
                    throw new Error(`Applied migration changed: ${name}`);
                }
                continue;
            }
            await connection.query(sql);
            await connection.query(
                "INSERT INTO foo_schema_migrations (name,checksum) VALUES ($1,$2)",
                [name, checksum],
            );
            console.log(`Applied ${name}`);
        }
        await connection.query("COMMIT");
    } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
    } finally {
        connection.release();
    }
}
migrate()
    .catch((error) => {
        console.error("Migration failed:", error.message);
        process.exitCode = 1;
    })
    .finally(() => db.end());
