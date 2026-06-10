# Provider Access Plan

Live cross-platform availability is an API partnership problem, not one generic
web-scraping problem. DinkWhere should connect only to provider-approved APIs,
venue-owned feeds, or public data whose terms explicitly permit automation.

## CourtReserve

- Official organization and enterprise APIs are available to eligible venue
  plans.
- Authentication uses API-issued Basic Auth credentials.
- Request read-only reservation/calendar permissions. Do not request member,
  payment, note, or contact-data access.
- The official API limit is 60 requests per minute per API key.
- Each venue admin must enable API and Webhook Access and issue credentials.
- Use venue middleware to convert CourtReserve's reservation response into
  `docs/provider-feed-contract.md` until its native response adapter is added.

Official documentation:

- https://api.courtreserve.com/apihelp/index
- https://help.courtreserve.com/en/articles/10414722-set-up-api-access-integration

## Playtomic

- Obtain partner or venue-authorized API access directly from Playtomic or each
  venue.
- Do not rely on undocumented mobile-app endpoints; they can change without
  notice and may not permit third-party aggregation.
- Configure each approved feed as a separate provider entry.

## MyActiveSG+

- Do not automate Singpass login, session cookies, CAPTCHA, or member booking
  flows.
- Seek a Sport Singapore data partnership or a venue-operated aggregate feed.
- Until access is approved, show the official booking link and
  `auth_required`, not estimated inventory.

## Reclub and venue-specific systems

- Ask for a read-only partner feed, webhook, calendar export, or venue-owned
  middleware endpoint.
- Public activity listings are not equivalent to court inventory; label them
  separately unless the source reports actual bookable capacity.

## Onboarding checklist

1. Obtain written permission and read-only credentials from the provider or
   venue.
2. Confirm rate limits, cache rules, attribution, and permitted retention.
3. Map upstream court IDs to DinkWhere court IDs.
4. Return aggregate counts only, never player or payment data.
5. Test one venue in staging before adding more venues on the same platform.
6. Add monitoring for stale data, HTTP 401/403, HTTP 429, and schema changes.
