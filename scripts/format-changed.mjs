import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const gitFiles = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" })
        .split("\0")
        .filter(Boolean);
const files = new Set([
    ...gitFiles(["diff", "--name-only", "--diff-filter=ACMR", "-z", "HEAD"]),
    ...gitFiles(["ls-files", "--others", "--exclude-standard", "-z"]),
]);

let count = 0;
for (const file of files) {
    const path = resolve(root, file);
    const info = await prettier.getFileInfo(path, {
        ignorePath: [
            resolve(root, ".gitignore"),
            resolve(root, ".prettierignore"),
        ],
    });
    if (info.ignored || !info.inferredParser) {
        continue;
    }
    const source = await readFile(path, "utf8");
    const options = await prettier.resolveConfig(path, { editorconfig: true });
    const formatted = await prettier.format(source, {
        ...options,
        filepath: path,
    });
    if (formatted !== source) {
        await writeFile(path, formatted);
    }
    console.log(`${file}${formatted === source ? " (unchanged)" : ""}`);
    count++;
}
console.log(`Formatted ${count} changed file(s).`);
