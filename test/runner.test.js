import { test } from "node:test";
import assert from "node:assert/strict";
import { processPage } from "../src/runner.js";

const config = {
  properties: { caption: "Caption", channels: "Channels", media: "Media", schedule: "Schedule", status: "Status", result: "Result", approval: "Request Approval", linkTracking: "Link Tracking" },
  statusValues: { ready: "Ready", posting: "Posting", posted: "Posted", failed: "Failed" },
  requestApproval: false,
  linkTracking: null,
  timezone: null,
};

const page = {
  properties: {
    Caption: { type: "title", title: [{ plain_text: "Hello" }] },
    Channels: { type: "multi_select", multi_select: [{ name: "x" }, { name: "bluesky" }] },
    Status: { type: "select", select: { name: "Ready" } },
  },
};

function fakes(postPlatforms) {
  const updates = [];
  return {
    updates,
    notion: { updatePage: async (_p, u) => updates.push(u) },
    bp: {
      listChannels: async () => [
        { id: 1, platform: "x", accountName: "a", isActive: true },
        { id: 2, platform: "bluesky", accountName: "b", isActive: true },
      ],
      listChannelSets: async () => [],
      getQuotaUsage: async () => ({}),
      getXUsage: async () => null,
      createPost: async () => ({ id: 9 }),
      publishPost: async () => ({}),
      getPost: async () => ({ postPlatforms }),
    },
  };
}

test("processPage: an unconfirmed destination marks the row Failed and warns before retrying", async () => {
  const f = fakes([
    { platform: "x", status: "published", platformUrl: "https://x.com/1" },
    { platform: "bluesky", status: "unconfirmed", platformUrl: null },
  ]);
  await processPage({ config, notion: f.notion, bp: f.bp, page, log: () => {} });
  const last = f.updates.at(-1);
  assert.equal(last.status, "Failed");
  assert.match(last.result, /x: https:\/\/x\.com\/1/);
  assert.match(last.result, /bluesky UNCONFIRMED: .*posted twice/);
});

test("processPage: every destination published marks the row Posted", async () => {
  const f = fakes([{ platform: "x", status: "published", platformUrl: "https://x.com/1" }, { platform: "bluesky", status: "published", platformUrl: "https://bsky.app/1" }]);
  await processPage({ config, notion: f.notion, bp: f.bp, page, log: () => {} });
  assert.equal(f.updates.at(-1).status, "Posted");
});
