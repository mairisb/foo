# foo

A mobile-friendly web wallet for your own loyalty cards.

First iteration: create an account or sign in, add a card with a name and zero, one, or two images, and open your saved cards to view the images. Images can be opened full size.

The interface uses shadcn/ui buttons, inputs, fields, and dialogs with its neutral theme, Tailwind CSS, and phone-friendly control sizes. Components live in src/components/ui; components.json records the base-nova preset. Base UI supplies the underlying accessibility and validation behavior. The login page opens on sign-in, with account creation available as a separate form.

Sharing, search, editing, and deletion are outside this iteration.

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

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection string |
| BETTER_AUTH_URL | Canonical app origin, initially http://localhost:3000 |
| DEV_APP_ORIGIN | Optional exact local-network origin for phone access during development |
| BETTER_AUTH_SECRET | Stable, random authentication secret |

In local development, http://localhost:3000 and http://127.0.0.1:3000 both support accounts and card creation. These aliases are accepted only for a configured loopback host, using the same protocol and port. DEV_APP_ORIGIN adds one explicitly configured address for phone testing. Production accepts only the canonical origin.

The development server listens on the local network. To use it from a phone on the same network, set DEV_APP_ORIGIN in .env to http:// followed by your computer's local IP and port 3000, then restart npm run dev. Next.js development assets and app authentication use the configured address. Keep the computer and server running while using the phone.

## Verify

```powershell
npx playwright install chromium
npm run typecheck
npm test
npm run build
```

Tests use synthetic accounts, cards, and images, and clean up only the accounts they create. They cover account isolation, image persistence, upload validation, existing number cards, and the complete create-and-read flow on desktop and a 390px phone viewport. Browser checks also detect console errors and exercise hydration with simulated browser-theme attributes. Screenshots and failure traces are saved in the ignored test-results folder.

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

Each new card accepts zero, one, or two JPG, PNG, or WebP images, up to 10 MB each. The server limits the complete request to 20 MB plus 64 KB of form overhead and decodes images with a 60-million-pixel limit. sharp applies camera orientation, resizes to fit within 2000 by 2000 pixels without enlarging, removes metadata, and re-encodes as JPEG. Each stored image is limited to 3 MB.

Image bytes live in PostgreSQL's card_images table and persist in the same Docker volume as the cards and accounts. Card and image writes are transactional. Images are served only to the signed-in owner through /api/cards/[id]/images/[position], with private no-store caching. Back up the database to preserve the images; there is no separate upload directory or public image URL.

Existing number-based cards and their barcode display remain readable. New cards do not ask for a number or barcode format. HEIC and other formats are not accepted in this iteration.

Migrations are transactional and checksummed. Do not edit applied files; add a new migration. The second migration narrows the original scaffold, and the third adds image storage while preserving existing accounts and number cards.

## Current limits

The app operates online and is local only. Public hosting, email verification, password recovery, and physical checkout-scanner validation remain future work. A web manifest does not provide offline card access.

Use npm run build and npm start for a local production build. Use npm run db:stop to stop PostgreSQL and npm run db:start to resume it; both preserve the data volume.
