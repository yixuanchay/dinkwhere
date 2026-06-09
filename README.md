# DinkWhere

A responsive prototype for discovering bookable and community pickleball courts
in Singapore.

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Current scope

- Search and filter a curated Singapore court directory.
- Compare illustrative time slots, prices, features, and source platforms.
- Link users to the official booking source to complete a reservation.
- Demonstrate anonymous, expiring community check-ins for free courts.
- Responsive list and map views.

Availability is intentionally labeled as demo data. A production release should
only display live inventory through provider-approved APIs or partnerships.
Private booker identity must never be collected or exposed.

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
