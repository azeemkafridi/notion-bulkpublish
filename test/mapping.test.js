import test from "node:test";
import assert from "node:assert/strict";
import {
  extractRow,
  resolveChannels,
  checkCharLimits,
  captionHasUrl,
  CHAR_LIMITS,
  buildPostBody,
} from "../src/mapping.js";
import { estimateXCostDcents, buildCostPreview } from "../src/cost.js";

const PROPS = {
  caption: "Caption",
  channels: "Channels",
  media: "Media",
  schedule: "Schedule",
  status: "Status",
  result: "Result",
  approval: "Request Approval",
  linkTracking: "Link Tracking",
};

/** Fake Notion page mimicking the real API shape. */
function makePage(overrides = {}) {
  return {
    id: "page-1",
    properties: {
      Caption: {
        type: "title",
        title: [{ plain_text: "Hello " }, { plain_text: "world" }],
      },
      Channels: {
        type: "multi_select",
        multi_select: [{ name: "x" }, { name: "linkedin" }],
      },
      Media: {
        type: "files",
        files: [
          { name: "pic.png", type: "file", file: { url: "https://files.notion.so/pic.png" } },
          { name: "ext.jpg", type: "external", external: { url: "https://example.com/ext.jpg" } },
        ],
      },
      Schedule: { type: "date", date: { start: "2026-07-04T10:00:00.000+05:00" } },
      Status: { type: "select", select: { name: "Ready" } },
      ...overrides,
    },
  };
}

// Mocked GET /api/channels response
const CHANNELS = [
  { id: "ch_1", platform: "x", accountName: "@bulkpublish", isActive: true },
  { id: "ch_2", platform: "linkedin", accountName: "BulkPublish", isActive: true },
  { id: "ch_3", platform: "instagram", accountName: "bulkpublish.gram", isActive: true },
  { id: "ch_4", platform: "x", accountName: "@old", isActive: false },
];

test("extractRow maps title, multi-select, files, date and status", () => {
  const row = extractRow(makePage(), PROPS);
  assert.equal(row.caption, "Hello world");
  assert.deepEqual(row.channelNames, ["x", "linkedin"]);
  assert.deepEqual(
    row.mediaFiles.map((f) => f.url),
    ["https://files.notion.so/pic.png", "https://example.com/ext.jpg"]
  );
  assert.equal(row.scheduledAt, "2026-07-04T10:00:00.000+05:00");
  assert.equal(row.status, "Ready");
});

test("extractRow reads the optional Request Approval column", () => {
  assert.equal(extractRow(makePage(), PROPS).requestApproval, false);
  assert.equal(
    extractRow(makePage({ "Request Approval": { type: "checkbox", checkbox: true } }), PROPS)
      .requestApproval,
    true
  );
  assert.equal(
    extractRow(makePage({ "Request Approval": { type: "checkbox", checkbox: false } }), PROPS)
      .requestApproval,
    false
  );
  assert.equal(
    extractRow(makePage({ "Request Approval": { type: "select", select: { name: "Yes" } } }), PROPS)
      .requestApproval,
    true
  );
});

test("extractRow reads the optional Link Tracking column as a tri-state", () => {
  // No column at all → null, meaning "inherit the organization setting".
  // This must NOT be false: false is a deliberate "publish links as written".
  assert.equal(extractRow(makePage(), PROPS).linkTrackingOverride, null);

  // A checkbox can only say on-or-nothing, so unticked stays null rather than
  // silently forcing tracking off for every row that has the column.
  assert.equal(
    extractRow(makePage({ "Link Tracking": { type: "checkbox", checkbox: true } }), PROPS)
      .linkTrackingOverride,
    true
  );
  assert.equal(
    extractRow(makePage({ "Link Tracking": { type: "checkbox", checkbox: false } }), PROPS)
      .linkTrackingOverride,
    null
  );

  // A select is the only way to express a real "off".
  assert.equal(
    extractRow(makePage({ "Link Tracking": { type: "select", select: { name: "Off" } } }), PROPS)
      .linkTrackingOverride,
    false
  );
  assert.equal(
    extractRow(makePage({ "Link Tracking": { type: "select", select: { name: "On" } } }), PROPS)
      .linkTrackingOverride,
    true
  );
  // An unrecognised or empty select falls back to inherit.
  assert.equal(
    extractRow(makePage({ "Link Tracking": { type: "select", select: { name: "maybe" } } }), PROPS)
      .linkTrackingOverride,
    null
  );
});

test("extractRow handles rich_text caption, status-type Status and empty schedule", () => {
  const row = extractRow(
    makePage({
      Caption: { type: "rich_text", rich_text: [{ plain_text: "  rt caption  " }] },
      Status: { type: "status", status: { name: "Ready" } },
      Schedule: { type: "date", date: null },
      Media: { type: "files", files: [] },
    }),
    PROPS
  );
  assert.equal(row.caption, "rt caption");
  assert.equal(row.status, "Ready");
  assert.equal(row.scheduledAt, null);
  assert.deepEqual(row.mediaFiles, []);
});

test("resolveChannels matches platform names, account names and IDs (active only, deduped)", () => {
  const byPlatform = resolveChannels(["x"], CHANNELS);
  assert.deepEqual(byPlatform.map((c) => c.id), ["ch_1"]); // inactive ch_4 excluded

  const mixed = resolveChannels(["X", "ch_2", "bulkpublish.gram", "linkedin"], CHANNELS);
  assert.deepEqual(mixed.map((c) => c.id).sort(), ["ch_1", "ch_2", "ch_3"]);
});

test("resolveChannels throws a descriptive error for unknown values", () => {
  assert.throws(
    () => resolveChannels(["myspace"], CHANNELS),
    /Channel "myspace" not found.*Connected channels/s
  );
});

test("checkCharLimits enforces the strictest targeted platform", () => {
  const channels = [CHANNELS[0], CHANNELS[1]]; // x (280) + linkedin (3000)
  assert.equal(checkCharLimits("short", channels), null);
  const long = "a".repeat(300);
  const msg = checkCharLimits(long, channels);
  assert.match(msg, /300 characters/);
  assert.match(msg, /x allows 280/);
  assert.equal(checkCharLimits(long, [CHANNELS[1]]), null); // linkedin alone is fine
  assert.equal(CHAR_LIMITS.facebook, 63206);
});

test("captionHasUrl detects links", () => {
  assert.equal(captionHasUrl("read https://bulkpublish.com now"), true);
  assert.equal(captionHasUrl("no links here"), false);
});

test("estimateXCostDcents: 15 plain / 200 with URL, +5 per media, 0 without X", () => {
  const x = [CHANNELS[0]];
  assert.equal(estimateXCostDcents({ caption: "hi", mediaCount: 0, targetChannels: x }), 15);
  assert.equal(
    estimateXCostDcents({ caption: "hi https://a.co", mediaCount: 2, targetChannels: x }),
    200 + 10
  );
  assert.equal(
    estimateXCostDcents({ caption: "hi https://a.co", mediaCount: 2, targetChannels: [CHANNELS[1]] }),
    0
  );
});

test("buildCostPreview logs usage and refuses when the daily quota is exhausted", () => {
  const quota = {
    plan: "pro",
    limits: { postsPerDay: 10, postsPerMonth: 100, mediaStorageMB: 1024 },
    usage: { postsToday: 10, postsThisMonth: 42, mediaStorageMB: 10 },
  };
  const xUsage = {
    credits: { balanceDcents: 100 },
    costs: { tweet_create: 15, tweet_create_with_url: 200, media_simple_upload: 5 },
  };
  const preview = buildCostPreview({
    caption: "check https://bulkpublish.com",
    mediaCount: 1,
    targetChannels: [CHANNELS[0]],
    quota,
    xUsage,
  });
  assert.match(preview.refusal, /Daily post quota exhausted \(10\/10/);
  assert.match(preview.line, /posts today 10\/10/);
  assert.match(preview.line, /est\. X cost .*205 dcents/);
  assert.match(preview.line, /13x plain-text price/);
  assert.match(preview.line, /X credit balance may be insufficient/);
  assert.equal(preview.estXCostDcents, 205);
});

test("buildCostPreview passes under quota and skips X info for non-X posts", () => {
  const quota = {
    plan: "free",
    limits: { postsPerDay: 5, postsPerMonth: 50 },
    usage: { postsToday: 1, postsThisMonth: 3 },
  };
  const preview = buildCostPreview({
    caption: "plain",
    mediaCount: 0,
    targetChannels: [CHANNELS[1]],
    quota,
    xUsage: null,
  });
  assert.equal(preview.refusal, null);
  assert.equal(preview.estXCostDcents, 0);
  assert.doesNotMatch(preview.line, /X cost/);
});

test("buildCostPreview refuses when the monthly quota is exhausted", () => {
  const quota = {
    plan: "starter",
    limits: { postsPerDay: 10, postsPerMonth: 30 },
    usage: { postsToday: 2, postsThisMonth: 30 },
  };
  const preview = buildCostPreview({
    caption: "plain",
    mediaCount: 0,
    targetChannels: [CHANNELS[1]],
    quota,
    xUsage: null,
  });
  assert.match(preview.refusal, /Monthly post quota exhausted \(30\/30/);
});

const CHANNEL_SETS = [
  { id: 1, name: "Launch Day", channelIds: ["ch_1", "ch_2", "ch_4"] },
  { id: 2, name: "Dead Set", channelIds: ["ch_4"] },
];

test("resolveChannels expands a channel set name into its active channels", () => {
  const bySet = resolveChannels(["launch day"], CHANNELS, CHANNEL_SETS);
  assert.deepEqual(bySet.map((c) => c.id).sort(), ["ch_1", "ch_2"]); // inactive ch_4 excluded

  // Mixing a set with a plain value dedupes overlapping channels.
  const mixed = resolveChannels(["Launch Day", "linkedin"], CHANNELS, CHANNEL_SETS);
  assert.deepEqual(mixed.map((c) => c.id).sort(), ["ch_1", "ch_2"]);
});

test("resolveChannels errors clearly when a set has no active channels, and lists set names for unknown values", () => {
  assert.throws(
    () => resolveChannels(["Dead Set"], CHANNELS, CHANNEL_SETS),
    /Channel set "Dead Set" matched, but none of its channels are active/
  );
  assert.throws(
    () => resolveChannels(["myspace"], CHANNELS, CHANNEL_SETS),
    /channel set name.*Channel sets: Launch Day, Dead Set/s
  );
});

test("buildPostBody: approval with no Schedule date is sent scheduled for now, never as a draft", () => {
  // The API ignores requestApproval on a draft, which the runner would then
  // publish with no review.
  const now = Date.parse("2026-09-24T08:00:00Z");
  const held = buildPostBody({ caption: "Hi", channelIds: ["c1"], requestApproval: true, timezone: "UTC", now });
  assert.equal(held.status, "scheduled");
  assert.equal(held.scheduledAt, "2026-09-24T08:00:00.000Z");
  assert.equal(held.requestApproval, true);
  assert.equal(held.publishWhenApproved, true);

  const scheduled = buildPostBody({
    caption: "Hi", channelIds: ["c1"], requestApproval: true, scheduledAt: "2026-10-01T09:00", timezone: "Asia/Karachi", now,
  });
  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.scheduledAt, "2026-10-01T09:00");
  assert.equal(scheduled.timezone, "Asia/Karachi");
  assert.equal("publishWhenApproved" in scheduled, false);

  const plain = buildPostBody({ caption: "Hi", channelIds: ["c1"], mediaIds: ["m1"], now });
  assert.equal(plain.status, "draft");
  assert.equal("scheduledAt" in plain, false);
  assert.equal("requestApproval" in plain, false);
  assert.deepEqual(plain.mediaFiles, ["m1"]);
  assert.equal(buildPostBody({ caption: "Hi", channelIds: ["c1"], linkTracking: false }).linkTrackingOverride, false);
});

import { resolveDiscordChannel as rdc, extractRow as er, buildPostBody as bpb } from "../src/mapping.js";

const guild = { id: 84, accountName: "BulkPublish", metadata: {} };
const opts = [{ id: "111", name: "general" }, { id: "222", name: "testing" }];

test("resolveDiscordChannel: matches by name (with or without #) and by id", () => {
  assert.equal(rdc("testing", guild, opts), "222");
  assert.equal(rdc("#Testing", guild, opts), "222");
  assert.equal(rdc("111", guild, opts), "111");
});

test("resolveDiscordChannel: unknown name fails and lists the choices", () => {
  assert.throws(() => rdc("nope", guild, opts), /not found in "BulkPublish".*#general, #testing/);
});

test("resolveDiscordChannel: nothing asked for uses the connection default, else fails with choices", () => {
  assert.equal(rdc(null, { ...guild, metadata: { channelId: "999" } }, []), null);
  assert.throws(() => rdc(null, guild, opts), /Discord needs a channel.*#general, #testing/);
});

test("extractRow: reads the Discord Channel column from a select or text property", () => {
  const names = { discordChannel: "Discord Channel" };
  assert.equal(er({ properties: { "Discord Channel": { type: "select", select: { name: "testing" } } } }, names).discordChannel, "testing");
  assert.equal(er({ properties: { "Discord Channel": { type: "rich_text", rich_text: [{ plain_text: " #general " }] } } }, names).discordChannel, "#general");
  assert.equal(er({ properties: {} }, names).discordChannel, null);
});

test("buildPostBody: sends platformSpecific only when there is something in it", () => {
  assert.deepEqual(bpb({ caption: "x", channelIds: [84], platformSpecific: { discord: { 84: { channelId: "222" } } } }).platformSpecific, { discord: { 84: { channelId: "222" } } });
  assert.equal("platformSpecific" in bpb({ caption: "x", channelIds: [84], platformSpecific: {} }), false);
});
