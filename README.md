# DinkWhere

A responsive prototype for discovering bookable and community pickleball courts
in Singapore.

## Run locally

```bash
npm start
```

Then open `http://localhost:4173`.

Node.js 22.5 or newer is required because the backend uses the built-in SQLite
driver.

## Deploy to Vercel

The production deployment uses:

- Vercel Functions for the existing Node API.
- Neon Postgres for accounts, sessions, reviews, reports, and user-added courts.
- Vercel Blob for uploaded court photos.
- Firebase Authentication for Google sign-in.

Local development continues to use SQLite and the local `uploads/` folder.

### 1. Create the Vercel project

Install and authenticate the CLI, then link this directory:

```bash
npx vercel login
npx vercel link
```

The included `vercel.json` routes the site and API through `api/index.js`.

### 2. Add persistent storage

In the Vercel project dashboard:

1. Open **Storage** and add the **Neon** integration.
2. Create a Postgres database in a region near Singapore.
3. Ensure the pooled connection string is exposed as `DATABASE_URL`.
4. Add a **Vercel Blob** store and connect it to the project.
5. Confirm Vercel created `BLOB_READ_WRITE_TOKEN`.

The Postgres tables are created automatically on the first request.

### 3. Add environment variables

Add these for the Production and Preview environments:

```env
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=dinkwhere.firebaseapp.com
FIREBASE_PROJECT_ID=dinkwhere
FIREBASE_APP_ID=...
AVAILABILITY_REFRESH_MS=300000
```

Add any approved provider-feed configuration and credentials separately. Never
commit `.env` or provider secrets.

### 4. Deploy

```bash
npx vercel --prod
```

After deployment:

1. Copy the generated `*.vercel.app` hostname.
2. In Firebase, open **Authentication > Settings > Authorized domains**.
3. Add the Vercel hostname.
4. Test Google sign-in, reviews, a live report, a court submission, and a photo
   upload before sharing the URL.

Vercel's function filesystem is not persistent. Do not set `DATABASE_PATH` for
production or attempt to store production uploads under `uploads/`.

## Current scope

- A directory of 49 bookable pickleball venues across 13 booking systems
  (`data/venues.json`, served at `GET /api/venues`). The full list is in
  `docs/booking-sources.md`.
- List, map and timeline views. The timeline shows free courts per hour for
  every venue with a live feed, and lists every other venue with a direct link
  to its booking page.
- A "Where to book" section describing each booking system and how DinkWhere
  connects to it.
- An island-wide community hard-court candidate map seeded from OpenStreetMap.
- Court profiles with reviews, photos, suitability fields, and live reports.

DinkWhere never books on a player's behalf and never shows who booked a court.
It shows aggregate free-court counts and sends players to the official booking
page.

## Venue directory and live availability

Venue details live in `data/venues.json`. Each venue has a `platform` key that
points at an entry in the file's `platforms` map. The map records how that
booking system can be connected:

- `live`: DinkWhere can read open slots itself. Playtomic publishes open slots
  per club without sign-in, and `lib/provider-engine.js` has a `playtomic`
  adapter for it. To switch it on, run the following from a machine with
  internet access:

  ```bash
  npm run playtomic:tenants
  ```

  This looks up each Playtomic venue's tenant ID and writes
  `data/providers.json`. The server loads that file automatically on start.
- `venue_feed`: CourtReserve, PlayByPoint, Rezerv, Smashing.sg and The Kallang
  have no public API. Live counts need a feed approved by the venue, following
  `docs/provider-feed-contract.md`.
- `deep_link`: MyActiveSG+ needs Singpass login and its terms prohibit
  automated access, so the site links to the ActiveSG pickleball venue list.
  Club portals, onePA, apps and phone-only venues are also linked directly.

The Play! Pickle Punggol snapshot in `data/availability-snapshots.json` is still
served for its capture date, 9 June 2026.

## Persistent community backend

The community features now use a server-side SQLite database rather than browser
storage. On first start, the server creates `data/dinkwhere.sqlite` and applies
the schema automatically.

Stored data includes:

- User accounts with `scrypt` password hashes.
- Server-side sessions using HTTP-only, SameSite cookies.
- Public display names, usernames, bios, review history, and report counts.
- Court reviews, ratings, suitability fields, and photo references.
- Live court reports that expire automatically after 90 minutes.

Uploaded JPEG, PNG, and WebP photos are validated, limited to 900 KB, and stored
under `uploads/`. Database files and uploaded photos are excluded from Git.

Back up both of these paths together:

```text
data/dinkwhere.sqlite
uploads/
```

For a single app instance, SQLite is a suitable persistent store. Before running
multiple server instances, move the same schema to a shared database such as
PostgreSQL and move uploads to object storage such as S3 or Cloudflare R2.

The production deployment should also add email verification, password reset,
rate limiting, moderation/reporting tools, image resizing and malware scanning.

## Google sign-in with Firebase

DinkWhere can use Firebase Authentication for Google identity while continuing
to store profiles, reviews, reports, sessions, and photo references in SQLite.
The browser's Firebase ID token is verified by the DinkWhere server before an
HTTP-only application session is created.

1. In Firebase, open **Project settings** and add a Web app.
2. Open **Authentication > Sign-in method**, enable **Google**, and choose a
   support email.
3. Under **Authentication > Settings > Authorized domains**, add the production
   domain. Add `localhost` for local development if it is not already present.
4. Copy the Web app configuration values into `.env`:

```env
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=dinkwhere.firebaseapp.com
FIREBASE_PROJECT_ID=dinkwhere
FIREBASE_APP_ID=...
```

5. Restart with `npm start`.

These Firebase Web configuration values identify the project and are expected
to be present in browser code. Do not add a service-account private key to the
frontend or commit it to Git.

After configuration, the account dialog shows **Continue with Google**. The
first successful sign-in creates a persistent SQLite user with a unique public
username. Subsequent sign-ins reuse that user, so their reviews remain attached
to the same profile. The account dialog includes a **My reviews** list and links
to the complete public review history.

## Connect authorized feeds

1. Copy `.env.example` to `.env`.
2. Copy `data/providers.example.json` to `data/providers.json`.
3. Add venue-approved feed URLs, court ID mappings, and credentials.
4. Ensure each feed follows `docs/provider-feed-contract.md`.
5. Restart with `npm start`.

The browser sends the selected date to the availability API. The server
refreshes stale feeds, deduplicates simultaneous requests, keeps the most recent
successful response when a provider is temporarily unavailable, and sends only
aggregate availability to the browser. Secrets remain server-side.

See `docs/provider-access-plan.md` for the access required from CourtReserve,
Playtomic, MyActiveSG+, Reclub, and venue-specific systems. Actual credentials
cannot be created by this repository; they must be issued by each provider or
venue.

## Provider access findings

- PickleliZe uses CourtReserve organization `13662`. Its public portal exposes
  venue details and opening hours, but the reservation schedule redirects to
  account login. Automated availability requires venue-issued API/feed access.
- MyActiveSG+ requires an ActiveSG account backed by Singpass for facility
  booking. Its terms prohibit automated bots and spiders, so DinkWhere does not
  automate the member booking flow.
- Until approved feeds are connected, these cards show factual venue details,
  direct booking links, and `Sign in at provider to view` instead of invented
  availability.

## Suggested production architecture

- Next.js frontend and API routes.
- Postgres + PostGIS for courts, geospatial search, reviews, and check-ins.
- Provider adapters with explicit rate limits, caching, and freshness metadata.
- Supabase Auth or Clerk for accounts and abuse-resistant community reports.
- Object storage with moderation for court photos.
- Scheduled reconciliation jobs for approved booking integrations.

## Initial venue sources

- Sport Singapore / MyActiveSG+
- Pickleball.sg venue directory
- PickleliZe
- Reclub public club and activity pages
- Singapore Sports Hub
- Civil Service Club Changi
- Playtomic-linked venue pages

## Community hard-court map

`data/community-courts.json` contains 855 mapped basketball, badminton, and
multi-sport pitches on Singapore's main island. Locations explicitly tagged
private, permit-only, customer-only, or inaccessible were excluded.

This is a discovery seed rather than an authoritative list of HDB-owned courts:
OpenStreetMap does not consistently record ownership, pickleball markings, nets,
or access conditions. The interface labels uncertain fields and lets players
confirm them through reviews and photos.

To refresh the seed from an Overpass JSON export:

```bash
node scripts/build-community-courts.js /path/to/overpass.json
```

Location data is © OpenStreetMap contributors and available under ODbL.

The interactive map uses Leaflet with OpenStreetMap tiles, so it does not require
a Google Maps API key. For production traffic, follow OpenStreetMap's tile usage
policy or use a dedicated OSM-compatible tile provider.
