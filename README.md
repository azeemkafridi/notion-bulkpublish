<p>
  <img src="https://img.shields.io/badge/BulkPublish-for%20Notion-FA8112?style=flat-square" alt="BulkPublish for Notion" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square" alt="Node 18+" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" />
</p>

# notion-bulkpublish

**BulkPublish for Notion** — turn a Notion database into a social media publishing queue.

Add rows to a Notion database. When you flip a row's **Status** to **Ready**, this service publishes it to your connected channels via the [BulkPublish](https://bulkpublish.com) API, writes the resulting post URL(s) back into the row, and flips Status to **Posted** (or **Failed** with the exact error).

Supports all BulkPublish platforms: Facebook, Instagram, X (Twitter), TikTok, YouTube, Threads, Bluesky, Pinterest, Google Business Profile, LinkedIn, Mastodon, Reddit, Discord, Telegram.

## How it works

```
Notion row (Status = Ready)
        │  poll every POLL_INTERVAL seconds
        ▼
notion-bulkpublish ── resolve channels, check char limits & quotas
        │             download Media files → upload to BulkPublish
        ▼
BulkPublish API ── publish now, or schedule if a Schedule date is set
        │
        ▼
Notion row updated: Status = Posted/Failed, Result = post URLs / error
```

## Setup

### 1. Notion integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) and click **New integration** (type: *Internal*). Give it read + update content capabilities.
2. Copy the **Internal Integration Secret** — this is your `NOTION_TOKEN`.
3. Open your database in Notion → `•••` menu → **Connections** → add your integration. (The service can only see databases explicitly shared with it.)
4. Copy the database ID from the URL: `https://www.notion.so/workspace/<DATABASE_ID>?v=...` — the 32-character hex string.

### 2. Notion database template

Create a database with these properties (names are the defaults; override any of them via env vars, see `.env.example`):

| Property   | Type                         | Purpose |
|------------|------------------------------|---------|
| `Caption`  | Title *or* Rich text         | The post text. |
| `Channels` | Multi-select                 | Where to post. Each option is a **platform name** (`x`, `linkedin`, `instagram`, …) which targets *all* your active channels on that platform, an **account name** (as shown in BulkPublish), a raw **channel ID**, or a **channel set name** (see below). |
| `Media`    | Files & media                | Images/videos to attach. Downloaded from Notion and uploaded to BulkPublish (max 100 MB each; jpeg/png/webp/gif/mp4/mov/webm). |
| `Schedule` | Date (with time)             | Optional. Set → the post is scheduled for that time. Empty → published immediately. |
| `Status`   | Select *or* Status           | Options: `Ready`, `Posting`, `Posted`, `Failed`. You set **Ready**; the service manages the rest. |
| `Result`   | Rich text (*or* URL)         | Written by the service: platform post URLs on success, the error message on failure. |
| `Request Approval` | Checkbox (optional)  | Tick to hold the post for team approval instead of publishing (see below). |
| `Link Tracking` | Select *or* Checkbox (optional) | Per-post override for bulkpubli.sh link tracking (see below). Use a **Select** with `On`/`Off` to force it either way; a checkbox can only force it *on*. |

### 3. BulkPublish API key

1. Sign up at [app.bulkpublish.com](https://app.bulkpublish.com/register) and connect your social channels.
2. Go to [app.bulkpublish.com/developer](https://app.bulkpublish.com/developer) and create an API key (`bp_...`).

### 4. Install & configure

```bash
git clone https://github.com/azeemkafridi/notion-bulkpublish
cd notion-bulkpublish
npm install
cp .env.example .env   # fill in NOTION_TOKEN, NOTION_DATABASE_ID, BULKPUBLISH_API_KEY
```

## Run

```bash
npm start                     # poll loop — checks for Ready rows every POLL_INTERVAL seconds (default 60)
npx notion-bulkpublish once   # single pass, then exit — ideal for cron / CI schedules
```

Example crontab entry (every 5 minutes):

```cron
*/5 * * * * cd /path/to/notion-bulkpublish && npx notion-bulkpublish once >> publish.log 2>&1
```

### Channel sets

**Channel sets** are saved channel groups in BulkPublish for one-click targeting (max **50 sets per org**; **names are unique per org**). Create them in the BulkPublish composer, then put the set's name in the `Channels` property — it expands to every active channel in the set. Resolution order when a value is ambiguous: channel ID → platform name → account name → channel set name.

## Row lifecycle

1. You set **Status = Ready**.
2. The service validates the row (caption present, channels resolvable, caption within every targeted platform's character limit), logs a **cost/quota preview**, and flips Status to **Posting** so a second pass can never double-post.
3. Media files are downloaded from Notion and uploaded to BulkPublish.
4. The post is created — published immediately, or scheduled if `Schedule` is set.
5. The service polls for per-platform outcomes and writes them into **Result**, then sets Status to **Posted** (or **Failed**).

If anything goes wrong, Status becomes **Failed** and **Result** contains the exact reason (e.g. `Caption is 300 characters, over the limit: x allows 280.`). Fix the row and set it back to **Ready** to retry.

## Approval flow

BulkPublish teams can require posts to be reviewed before they go out. Approval is **orthogonal to the post status**: a post whose `approvalStatus` is `pending` or `rejected` does not publish, even when it is scheduled and its time has passed.

- Tick the optional **`Request Approval`** checkbox on a row (or set `BULKPUBLISH_REQUEST_APPROVAL=true` to apply it to every row) and the created post gets `approvalStatus = pending`. A row with no Schedule date is submitted as scheduled for now, because approval applies only to scheduled posts. **Result** then reads *"Waiting for approval…"* rather than claiming the post is on its way.
- A teammate whose role has `post:approve` (owner, admin, approver) approves or rejects it at [app.bulkpublish.com/posts](https://app.bulkpublish.com/posts). Approving publishes the post at its scheduled time, or immediately if that time passed less than 15 minutes ago; if it passed more than 15 minutes ago, the post is approved but kept as a draft and the author is notified to choose a new time. Rejecting returns it to draft with a reason and notifies the author.
- Members whose role lacks `post:publish` (contributors) have scheduled posts held for approval **server-side regardless of the checkbox**. If such a key tries to publish immediately, the row is marked **Failed** with *"Your role can't publish directly — submit for approval instead."*

The library client also exposes `approvePost(id)`, `rejectPost(id, reason)` and `listPosts({ approvalStatus })` for scripting your own review tooling. After `approvePost`, check the returned post's `status`: `draft` means it was approved too late to publish and needs a new time. Both calls return 409 if the post changed while you were reviewing it (someone else approved, rejected or withdrew it, or, on approve, its scheduled time moved); reload it and review again.

## Link tracking

BulkPublish can rewrite the links in a post to `bulkpubli.sh` short URLs and count the clicks — something no platform API reports (X removed outbound click data entirely). It is **off by default** and opt-in per organization in *Settings → Link Tracking*.

The optional **`Link Tracking`** column overrides that setting for one row:

- **Select** with `On` / `Off` — forces tracking on or off for that row. This is the only way to express a real "off".
- **Checkbox** — ticked forces tracking on; **unticked means "inherit", not "off"**. A checkbox has no third state, and reading unticked as "off" would silently disable tracking on every row the moment you added the column.
- No column, or an empty/unrecognised select → inherits the organization setting.

`BULKPUBLISH_LINK_TRACKING=true|false` applies an override to every row; a row's own column wins over it.

Two things worth knowing:

- Links are rewritten **at publish time, per channel**, so the same post going to two accounts on one platform gets distinct codes and their clicks are counted separately.
- Shortening is **skipped** for any channel where the rewrite would push the post past that platform's character limit. A short URL is 28 characters and can be *longer* than the link it replaces, so on X (280) or Bluesky (300) a post that was accepted could otherwise fail to publish. The post still goes out — with its original links — and records no clicks for that channel.

## Character limits (checked client-side)

| Platform | Limit | | Platform | Limit |
|---|---|---|---|---|
| X (Twitter) | 280 | | GMB | 1,500 |
| Bluesky | 300 | | Instagram / TikTok | 2,200 |
| Threads / Mastodon / Pinterest | 500 | | LinkedIn | 3,000 |
| YouTube | 5,000 | | Facebook | 63,206 |

## Cost & quota notes

Before publishing each row the service fetches your plan usage and logs a preview line, e.g.:

```
[quota] posts today 3/50 | posts this month 41/500 | est. X cost $0.205 (205 dcents) — caption contains a URL (13x plain-text price)
```

- **Daily/monthly post quotas** — if your plan's quota is exhausted, the row is marked **Failed** with a clear message instead of burning an API call.
- **X (Twitter) is credit-metered** (dcents: $1 = 1,000 dcents). A plain tweet costs **15 dcents**, but a tweet **containing a URL costs 200 dcents — about 13× more**. Each media file adds 5 dcents. If your caption targets X, consider whether that link is worth it. The preview warns when your X credit balance looks insufficient.

## Development

```bash
npm test   # unit tests (node:test) for property mapping + cost preview — no network needed
```

## License

MIT
