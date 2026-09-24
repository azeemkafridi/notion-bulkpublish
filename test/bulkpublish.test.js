import test from "node:test";
import assert from "node:assert/strict";
import { BulkPublishClient } from "../src/bulkpublish.js";

function recorder() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body });
    return new Response(JSON.stringify({ id: "p1" }), { status: 200 });
  };
  return { calls, client: new BulkPublishClient({ apiKey: "bp_test", fetchImpl }) };
}

test("approve/reject send no ifUnmodifiedSince unless given", async () => {
  const { calls, client } = recorder();
  await client.approvePost("p1");
  await client.rejectPost("p1", "off brand");
  assert.match(calls[0].url, /\/api\/posts\/p1\/approve$/);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body, undefined);
  assert.deepEqual(JSON.parse(calls[1].body), { reason: "off brand" });
});

test("approve/reject forward ifUnmodifiedSince when given", async () => {
  const { calls, client } = recorder();
  const since = "2026-09-24T09:00:00.000Z";
  await client.approvePost("p1", { ifUnmodifiedSince: since });
  await client.rejectPost("p1", "off brand", { ifUnmodifiedSince: since });
  await client.rejectPost("p1", undefined, { ifUnmodifiedSince: since });
  assert.deepEqual(calls.map((c) => JSON.parse(c.body)), [
    { ifUnmodifiedSince: since },
    { reason: "off brand", ifUnmodifiedSince: since },
    { ifUnmodifiedSince: since },
  ]);
});

test("a 409 surfaces as an error with status 409", async () => {
  const client = new BulkPublishClient({
    apiKey: "bp_test",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { code: "CONFLICT", message: "changed" } }), { status: 409 }),
  });
  await assert.rejects(client.approvePost("p1", { ifUnmodifiedSince: "2026-09-24T09:00:00.000Z" }), (e) => e.status === 409);
});
