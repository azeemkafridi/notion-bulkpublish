import { test } from "node:test";
import assert from "node:assert/strict";
import { processPage } from "../src/runner.js";

const config = {
  properties: { caption: "Caption", channels: "Channels", media: "Media", schedule: "Schedule", status: "Status", result: "Result", approval: "Request Approval", linkTracking: "Link Tracking", discordChannel: "Discord Channel" },
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

test("processPage: a Discord row with no channel fails before anything is created", async () => {
  const f = fakes([]);
  let created = false;
  f.bp.listChannels = async () => [{ id: 84, platform: "discord", accountName: "BulkPublish", isActive: true, metadata: {} }];
  f.bp.getChannelOptions = async () => [{ id: "222", name: "testing" }];
  f.bp.createPost = async () => { created = true; return { id: 1 }; };
  const discordPage = { properties: { ...page.properties, Channels: { type: "multi_select", multi_select: [{ name: "discord" }] } } };
  await processPage({ config: { ...config, discordChannel: null }, notion: f.notion, bp: f.bp, page: discordPage, log: () => {} });
  assert.equal(created, false);
  assert.equal(f.updates.at(-1).status, "Failed");
  assert.match(f.updates.at(-1).result, /#testing/);
});

test("processPage: a Discord row sends its channel keyed by platform, then channel id", async () => {
  const f = fakes([{ platform: "discord", status: "published", platformUrl: "https://discord.com/x" }]);
  let body;
  f.bp.listChannels = async () => [{ id: 84, platform: "discord", accountName: "BulkPublish", isActive: true, metadata: {} }];
  f.bp.getChannelOptions = async () => [{ id: "222", name: "testing" }];
  f.bp.createPost = async (b) => { body = b; return { id: 1 }; };
  const discordPage = { properties: { ...page.properties, Channels: { type: "multi_select", multi_select: [{ name: "discord" }] }, "Discord Channel": { type: "rich_text", rich_text: [{ plain_text: "testing" }] } } };
  await processPage({ config, notion: f.notion, bp: f.bp, page: discordPage, log: () => {} });
  assert.deepEqual(body.platformSpecific, { discord: { 84: { channelId: "222" } } });
  assert.equal(f.updates.at(-1).status, "Posted");
});
