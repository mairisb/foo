# foo

A mobile-friendly web wallet for your own loyalty cards.

First iteration: create an account or sign in, add a card with a name and any number of optional images, and open your saved cards to view the images. Images can be opened full size. Edit a card's name and add, remove, or reorder images, or delete the card after confirming.

The interface uses shadcn/ui buttons, inputs, fields, and dialogs with its neutral theme, Tailwind CSS, and phone-friendly control sizes. Components live in src/components/ui; components.json records the base-nova preset. Base UI supplies the underlying accessibility and validation behavior. The login page opens on sign-in, with account creation available as a separate form.

Sharing and search are outside this iteration.

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

Each new card accepts any number of JPG, PNG, or WebP images, up to 10 MB each. Cards with no images are valid. Select several images at once or choose again to append more, preview them, remove individual selections, and use the up/down buttons to change their order before saving.

The server streams uploads with busboy into a private temporary directory and normalizes and stores one image at a time, keeping the complete upload out of memory. Temporary files are removed when the request finishes. There is no image-count or aggregate upload-size cap. Images are decoded with a 60-million-pixel limit. sharp applies camera orientation, resizes to fit within 2000 by 2000 pixels without enlarging, removes metadata, and re-encodes as JPEG. Each stored image is limited to 3 MB.

Image bytes live in PostgreSQL's card_images table and persist in the same Docker volume as the cards and accounts. Card and image writes are transactional. Images are served only to the signed-in owner through /api/cards/[id]/images/[position], with private no-store caching. Back up the database to preserve the images; there is no separate upload directory or public image URL.

Existing number-based cards and their barcode display remain readable. New cards do not ask for a number or barcode format. HEIC and other formats are not accepted in this iteration.

Migrations are transactional and checksummed. Do not edit applied files; add a new migration. The second migration narrows the original scaffold, the third adds image storage, the fourth removes the two-image restriction, and the fifth adds card revisions for safe editing.

## Editing and deletion

Open a card and choose Edit card to change its name, add or remove images, or use the up/down buttons to reorder saved and newly selected images together. Changes apply together when you choose Save changes. Cancel or Close discards the draft. Saved images keep their original stored bytes; new images use the normal upload validation. Existing numbers and barcodes are preserved.

Editing loads the current card and includes its revision when saving. The server checks ownership and locks the card during the transaction. An older edit receives a conflict error instead of overwriting newer changes; close and reopen the editor to load the current version. Image URLs include the revision so the view refreshes photos after removals change their positions.

Delete card requires confirmation and permanently removes the card and all its images. There is no undo.

## Icons

The header and favicon use the Material Symbols cards-stack icon in white on a rounded black background. Edit public/icon.svg, then run npm run icons:generate to regenerate the 16/32px favicon, 180px phone icon, and 192/512px app icons. Attribution and the icon's license are in public/licenses.

## Current limits

The app operates online and is local only. Public hosting, email verification, password recovery, and physical checkout-scanner validation remain future work. A web manifest does not provide offline card access.

Use npm run build and npm start for a local production build. Use npm run db:stop to stop PostgreSQL and npm run db:start to resume it; both preserve the data volume.
