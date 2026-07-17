# Changelog

## 1.1.0 (2026-07-17)

- Channel sets: the `Channels` property now also accepts a **channel set name** — a saved channel group in BulkPublish (max 50 sets per org, names unique per org) — which expands to every active channel in the set. Client: new `listChannelSets()` (GET /api/channel-sets).
- RSS feed management and multipart (>100 MB) media upload endpoints exist in the API but are not surfaced by this integration.

## 1.0.1 (2026-07-16)

- Docs: 14 supported platforms (added Reddit, Discord, Telegram).

