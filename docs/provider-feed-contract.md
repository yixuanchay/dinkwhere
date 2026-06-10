# Provider Feed Contract

DinkWhere accepts venue-approved availability feeds through server-side
configuration. A feed may represent one venue or several venues.

## Provider configuration

Copy `data/providers.example.json` to `data/providers.json` and set
`PROVIDERS_CONFIG_PATH=data/providers.json` in `.env`.

Each provider supports:

- A URL containing `{date}`, or `dateQueryParam` for a query-string date.
- `basic`, `bearer`, or custom `header` authentication.
- `env:VARIABLE_NAME` secret references so credentials do not enter JSON.
- `courtIds` mappings from provider IDs to the IDs used in `app.js`.
- Multiple independently authenticated venues on the same booking platform.

The upstream endpoint may be the provider's approved API or venue-controlled
middleware that translates a native API response into this contract.

## Response

```json
{
  "generatedAt": "2026-06-09T13:00:00+08:00",
  "timezone": "Asia/Singapore",
  "courts": [
    {
      "courtId": "play-pickle-punggol",
      "date": "2026-06-09",
      "totalCourts": 6,
      "sourceUrl": "https://official-booking-page.example",
      "slots": [
        {
          "start": "13:00",
          "availableCourts": 5
        }
      ]
    }
  ]
}
```

## Rules

- `courtId` must match the ID used in `app.js`.
- A provider config `courtIds` mapping may translate an upstream ID instead.
- Times use 24-hour `HH:MM` format in `Asia/Singapore`.
- Send aggregate availability only.
- Do not send customer names, email addresses, phone numbers, member IDs,
  reservation notes, payment data, or other personal information.
- `availableCourts` must be an integer from zero through `totalCourts`.
- Feed access must be authorized by the venue or booking provider.

CourtReserve credentials and provider tokens belong in `.env`, never in
frontend JavaScript or source control.

## Browser API

The frontend requests:

```text
GET /api/availability?date=2026-06-10
```

The server refreshes only stale feeds for that date, deduplicates simultaneous
requests, and falls back to the last successful response if a provider is
temporarily unavailable.
