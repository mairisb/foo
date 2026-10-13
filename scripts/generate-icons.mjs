import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../public/icon.svg", import.meta.url));
const sizes = [16, 32, 180, 192, 512];
const pngs = new Map();
for (const size of sizes) {
  pngs.set(size, await sharp(svg).resize(size, size).png().toBuffer());
}
for (const [size, name] of [[180, "apple-touch-icon.png"], [192, "icon-192.png"], [512, "icon-512.png"]]) {
  await writeFile(new URL(`../public/${name}`, import.meta.url), pngs.get(size));
}

// An ICO directory followed by PNG frames supplies both common tab sizes.
const faviconSizes = [16, 32];
const directory = Buffer.alloc(6 + 16 * faviconSizes.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(faviconSizes.length, 4);
let offset = directory.length;
for (const [index, size] of faviconSizes.entries()) {
  const entry = 6 + index * 16;
  const png = pngs.get(size);
  directory[entry] = size;
  directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(png.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += png.length;
}
await writeFile(new URL("../public/favicon.ico", import.meta.url), Buffer.concat([directory, ...faviconSizes.map(size => pngs.get(size))]));
console.log("Generated favicon and phone icons from public/icon.svg.");
