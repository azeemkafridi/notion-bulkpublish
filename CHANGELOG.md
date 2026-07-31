# Changelog

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

