# Changelog

## 1.4.2 (2026-09-23)

### Changed

- Approval docs (README and the `approvePost` / `rejectPost` JSDoc) match the server:
  approving publishes a pending post at its scheduled time, or immediately if that time
  passed less than 15 minutes ago. If it passed more than 15 minutes ago, the post is
  approved but not published — it comes back with status `draft` (approvalStatus
  `approved`, scheduledAt unchanged) and the author is notified to choose a new time.
- Documented the 409 that approve and reject return when the post stopped awaiting
  approval while the request was in flight (approved, rejected or withdrawn by someone
  else). Reload it and review again.

## 1.4.1 (2026-08-26)

### Changed

- Package description said 16 platforms, counting Reddit, which cannot be newly
  connected. Now 15, matching the other integrations.

## 1.4.0 (2026-08-19)

- **Snapchat support (16th platform).** `snapchat` added to the platform character-limit map (160 — the caption is only used as the Spotlight description and as a saved-story title fallback; plain Snapchat stories carry no text) and display names. Every Snapchat post requires exactly ONE media file: a jpg/png image or an mp4 video; Spotlight is video-only (6-60s). Post types: `story` (default), `saved_story`, `spotlight`.
- Package description: 15 -> 16 platforms.

## 1.3.1 (2026-08-08)

- Fixed: **`CHAR_LIMITS` was missing Reddit, Discord, Telegram and Tumblr**, so the client-side caption guard silently skipped every row targeting them — a 3,000-character caption bound for Discord (limit 2,000) passed local validation and only failed server-side at publish. Added Reddit 40,000, Discord 2,000, Telegram 4,096 and Tumblr 32,768. This was the only integration whose platform map still lagged the 15 supported platforms. 14 tests pass.

## 1.3.0 (2026-08-01)

- **Link tracking.** New optional `Link Tracking` column (override the name with `NOTION_PROP_LINK_TRACKING`) sets `linkTrackingOverride` per row: a **Select** of `On`/`Off` forces bulkpubli.sh shortening either way, while a **Checkbox** can only force it on — unticked means *inherit*, not *off*, so adding the column never silently disables tracking. `BULKPUBLISH_LINK_TRACKING=true|false` applies a run-wide override, and a row's own column wins over it.
- Fixed: **`npm test` never ran the test suite.** The script was `node --test test/`, which Node resolves as a *module* path and fails on with `MODULE_NOT_FOUND` — so the suite reported a failure without executing a single assertion. Now `node --test test/*.test.js`; 14 tests pass.
- Fixed: the package description said 14 platforms; Tumblr brought it to 15.

## 1.2.0 (2026-07-24)

- **Post approval flow.** New optional `Request Approval` checkbox column (override with `NOTION_PROP_APPROVAL`) sends `requestApproval: true` so the scheduled post is held for team approval (`approvalStatus` becomes `pending`) instead of going out. `BULKPUBLISH_REQUEST_APPROVAL=true` applies it to every row.
- `Result` now says when a post is waiting for approval instead of claiming it was scheduled to publish.
- Publish 403 `APPROVAL_REQUIRED` (roles without `post:publish`) is reported as "Your role can't publish directly — submit for approval instead."
- Client: `approvePost(id)`, `rejectPost(id, reason)` (POST /api/posts/{id}/approve|reject, needs `post:approve` — owner/admin/approver) and `listPosts({ approvalStatus })`.

## 1.1.0 (2026-07-17)

- Channel sets: the `Channels` property now also accepts a **channel set name** — a saved channel group in BulkPublish (max 50 sets per org, names unique per org) — which expands to every active channel in the set. Client: new `listChannelSets()` (GET /api/channel-sets).
- RSS feed management and multipart (>100 MB) media upload endpoints exist in the API but are not surfaced by this integration.

## 1.0.1 (2026-07-16)

- Docs: 14 supported platforms (added Reddit, Discord, Telegram).

