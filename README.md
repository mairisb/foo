# foo

A mobile-friendly web wallet for your own loyalty cards.

First iteration: create an account or sign in, add a card with a name and any number of optional images, and open your saved cards to view the images. Images can be opened full size. Edit a card's name and add, remove, or reorder images, or delete the card after confirming.

The interface uses shadcn/ui buttons, inputs, fields, and dialogs with its neutral theme, Tailwind CSS, and phone-friendly control sizes. Components live in src/components/ui; components.json records the base-nova preset. Base UI supplies the underlying accessibility and validation behavior. The login page opens on sign-in, with account creation available as a separate form.

Sharing and search are outside this iteration.

Dialogs keep their title visible while content scrolls. Card details have a vertical-ellipsis menu in the header for Edit card and Delete card, with Close in the fixed footer. Creation and editing keep Cancel and Save in the footer; delete confirmation keeps Cancel and Delete there.

Android and browser Back close an open card and return to the wallet. Back from editing returns to the card and discards unsaved changes; Back from creation discards the new draft. Forward can reopen the view. Saving and deletion keep their dismissal guards while pending.

## Run locally

Requires Node.js 24 or a compatible supported runtime, npm, and running Docker Desktop with Linux containers.

```powershell
npm ci
npm run setup
npm run db:start
npm run db:migrate
npm run dev
```

Open http://localhost:3000. `setup` creates an ignored .env with a generated random auth secret and preserves an existing file. PostgreSQL runs on loopback port 15432 with a persistent Docker volume. The local database credentials are development defaults.

## Configuration

| Variable           | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| DATABASE_URL       | PostgreSQL connection string                                            |
| BETTER_AUTH_URL    | Canonical app origin, initially http://localhost:3000                   |
| DEV_APP_ORIGIN     | Optional exact local-network origin for phone access during development |
| BETTER_AUTH_SECRET | Stable, random authentication secret                                    |

In local development, http://localhost:3000 and http://127.0.0.1:3000 both support accounts and card creation. These aliases are accepted only for a configured loopback host, using the same protocol and port. DEV_APP_ORIGIN adds one explicitly configured address for phone testing. Production accepts only the canonical origin.

The development server listens on the local network. To use it from a phone on the same network, set DEV_APP_ORIGIN in .env to http:// followed by your computer's local IP and port 3000, then restart npm run dev. Next.js development assets and app authentication use the configured address. Keep the computer and server running while using the phone.

## Verify

```powershell
npx playwright install chromium
npm run typecheck
npm run format:check
npm run lint
npm test
npm run build
```

Tests use synthetic accounts, cards, and images, and clean up only the accounts they create. They cover account isolation, image persistence and reordering, upload validation, existing number cards, editing and rollback, stale and concurrent edits, confirmed deletion and image cleanup, cancellation, failure and retry, and the complete card flow on desktop and a 390px phone viewport. Browser checks also detect console errors and exercise hydration with simulated browser-theme attributes. Screenshots and failure traces are saved in the ignored test-results folder.

## Formatting and linting

Use four spaces for indentation. Every `if`, `else`, and loop body requires curly braces. Prettier formats source, tests, scripts, and supported configuration files; ESLint checks all JavaScript and TypeScript with the Next.js, React, and TypeScript rules. Warnings fail linting.

After each code change, run:

```powershell
npm run format:changed
npm run lint
```

`format:changed` includes staged, unstaged, and untracked files and handles route filenames containing brackets. Use `npm run format` to format the whole project, `npm run format:check` to check it, or `npm run lint:fix` to apply available lint fixes. Run Prettier after lint fixes. Generated output, the lockfile, third-party licenses, and applied SQL migrations are excluded from formatting. Migrations retain their checksums.

VS Code settings enable formatting and ESLint fixes on save with the recommended Prettier and ESLint extensions. `.editorconfig` also specifies four spaces and LF line endings.

The `typescript` dependency supplies the TypeScript 6 compatibility API for ESLint. The `@typescript/native` alias retains the TypeScript 7 compiler; `npm run typecheck` invokes it directly to avoid executable-name conflicts. This follows the [TypeScript side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0).

## Code

- src/app: pages and API endpoints.
- src/components: account, wallet, and card views.
- src/lib: shared validation, types, and browser clients.
- src/server: auth, database, card, and barcode logic.
- migrations: versioned application SQL.
- scripts: local setup and migrations.
- tests: API and browser verification.

Better Auth handles credentials and sessions. Parameterized SQL queries through pg check ownership on every card, image, and legacy barcode request. TypeORM is deferred.

## Images

Each new card accepts any number of JPG, PNG, or WebP images, up to 10 MB each. Cards with no images are valid. Use Add images, drag files into the image upload area, or paste clipboard images with Ctrl+V or the browser's Paste action while creating or editing a card. Image paste works anywhere in the card dialog, including the name field and footer; text-only paste keeps its normal behavior. Each selection, drop, or image paste appends to the draft with the same format and size checks. Preview them, remove individual selections, and use the up/down buttons to change their order before saving. The left/right rotation buttons turn each image by 90 degrees and immediately update its preview. Rotation follows the image when reordered, and Cancel discards it. Image additions are disabled while saving or adjusting corners; dropping files outside the upload area while a card form is open does not navigate away.

Use the rounded-corner icon beside an image's ordering and rotation buttons to straighten a photographed card using [Scanic](https://marquaye.github.io/scanic/guide/corner-editor). Its modal fits the editor between a fixed header and footer without scrolling or introductory text. Place the four corners yourself by dragging the handles or using the arrow keys on a focused handle. Corner selection is entirely manual.

The undo icon at the header's right restores the default inset outline; the eye icon opens the corrected rectangle in a separate preview modal view. Close in the preview footer, Escape, or browser/Android Back returns to the same corner selection. Cancel and Apply stay in the editor footer. Apply puts the corrected image into the card draft; Cancel, Escape, or browser/Android Back returns to the card form with its draft intact. Save the card to keep an applied correction; canceling the card discards it.

Scanic loads when the corner tool opens and processes the image in the browser. The editor and extraction API use a canvas capped at 2000px per side, with existing rotation applied before manual adjustment. The corrected JPEG becomes a draft upload. Replacing a saved image uses the existing transactional removal, upload, ordering, and revision checks, with normal server image validation. Extraction and canvas-encoding failures keep the tool available for retry; controls and dialog dismissal are guarded during conversion.

The server streams uploads with busboy into a private temporary directory and normalizes and stores one image at a time, keeping the complete upload out of memory. Temporary files are removed when the request finishes. There is no image-count or aggregate upload-size cap. Images are decoded with a 60-million-pixel limit. sharp applies camera orientation, then the requested quarter-turn rotation, resizes to fit within 2000 by 2000 pixels without enlarging, removes metadata, and re-encodes as JPEG. Each stored image is limited to 3 MB.

Image bytes live in PostgreSQL's card_images table and persist in the same Docker volume as the cards and accounts. Card and image writes are transactional. Images are served only to the signed-in owner through /api/cards/[id]/images/[position], with private no-store caching. Back up the database to preserve the images; there is no separate upload directory or public image URL.

Existing number-based cards and their barcode display remain readable. New cards do not ask for a number or barcode format. HEIC and other formats are not accepted in this iteration.

Migrations are transactional and checksummed. Do not edit applied files; add a new migration. The second migration narrows the original scaffold, the third adds image storage, the fourth removes the two-image restriction, the fifth adds card revisions for safe editing, and the sixth adds extracted codes.

Use the barcode-scanner icon beside an image's rotation controls while creating or editing a card. It extracts supported barcodes and QR codes into the draft, skips duplicates, and shows a success or failure toast. Extracted symbols and their values appear between the card name and images. Remove codes in the editor; Save keeps additions/removals, and Cancel discards them. Codes remain on the card if their source image is removed. Existing number-based barcodes are preserved separately.

Decoding and symbol generation use zxing-wasm in the browser, with the matching WebAssembly file served by the app at /barcode-engine.wasm. No scan image is sent to an external service, and no browser BarcodeDetector or camera permission is required. Scanning handles multiple codes, rotation, inversion, and camera orientation on a canvas capped at 3000px per side. Poor or small symbols may require a clearer image or manual corner adjustment. The first scan or code display loads the engine. Pending scanning disables draft actions and dismissal; failed scans can retry.

Extracted codes live in cards.codes in PostgreSQL. The optional codes multipart field is a JSON array of format, text, bytes (base64 raw payload), and gs1 objects, limited to 64 unique codes and 4 MiB of form metadata. Values and payloads are bounded and validated. Creation defaults to no codes; edits that omit the field preserve existing codes, and an empty array removes all extracted codes. Code changes use the same transaction, revision, session, and origin checks as card/image edits.

## Editing and deletion

Click a saved card image to view it in the same tab, filling the browser page with the complete image and a close X. Portrait and landscape images fit without cropping or scrolling. Close with X, Escape, or browser/Android Back to return to the same card and scroll position. Forward and refresh restore a valid image view. A load failure keeps the viewer closable; reopen it to retry. No new tab is opened.

Open a card's header menu and choose Edit card to change its name, add or remove images, rotate them left or right, adjust their document corners, or use the up/down buttons to reorder saved and newly selected images together. Changes apply together when you choose Save changes. Cancel discards the draft. Saved images keep their stored bytes unless rotated or straightened; transformed images are re-encoded with the normal image limits. New images use the normal upload validation. Existing numbers and barcodes are preserved.

Multipart uploads use the images field for unrotated files and images:90, images:180, or images:270 for clockwise rotation relative to camera-corrected orientation. Editing optionally includes rotateImages, a JSON array of position/rotation objects referring to original saved positions, with angles 0, 90, 180, or 270. Saved rotations run before removal and reordering in the same transaction. Duplicate, missing, or removed positions and invalid angles are rejected; a failed rotation, upload, or stale edit leaves the card unchanged.

Editing loads the current card and includes its revision when saving. The server checks ownership and locks the card during the transaction. An older edit receives a conflict error instead of overwriting newer changes; close and reopen the editor to load the current version. Image URLs include the revision so the view refreshes photos after removals change their positions.

Delete card requires confirmation and permanently removes the card and all its images. There is no undo.

## Icons

UI icons use rounded variants from the Material Symbols collection shown on shadcn.io. Choose the -rounded variants when adding icons. The local React components in src/components/icons.tsx cover dialog/menu controls, image tools, selectors, loading, and toast messages without runtime icon-service requests. Reuse these components when adding controls, including in generated shadcn/ui components. Icon attribution and the Apache 2.0 license are in public/licenses.

The header and favicon use the rounded Material Symbols cards-stack icon in white on a rounded black background. Edit public/icon.svg, then run npm run icons:generate to regenerate the 16/32px favicon, 180px phone icon, and 192/512px app icons. Attribution and the icon's license are in public/licenses.

Home-screen PNGs use an opaque black background and extra padding around the same white symbol. The manifest declares the 192/512px assets as both regular and maskable icons; the 180px touch icon uses the same artwork for shortcut fallback. Android can apply its launcher shape without exposing transparent corners or clipping the symbol. After changing these assets, bump their URL versions in the manifest and page metadata, refresh the page, and remove and re-add an existing home-screen shortcut to pick up the new icon. The launcher and browser still control the final shape and padding.

## Current limits

The app operates online and is local only. Public hosting, email verification, password recovery, and physical checkout-scanner validation remain future work. A web manifest does not provide offline card access.

Use npm run build and npm start for a local production build. Use npm run db:stop to stop PostgreSQL and npm run db:start to resume it; both preserve the data volume.
