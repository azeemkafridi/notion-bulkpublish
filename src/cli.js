#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { NotionStore } from "./notion.js";
import { BulkPublishClient } from "./bulkpublish.js";
import { runOnce } from "./runner.js";

const HELP = `notion-bulkpublish — publish to social media from a Notion database via BulkPublish

Usage:
  notion-bulkpublish            Poll loop (every POLL_INTERVAL seconds, default 60)
  notion-bulkpublish once       Single pass, then exit (ideal for cron)
  notion-bulkpublish --help     Show this help

Configuration is read from environment variables / a .env file:
  NOTION_TOKEN, NOTION_DATABASE_ID, BULKPUBLISH_API_KEY, POLL_INTERVAL
See the README for the Notion database schema and property-name overrides.`;

async function main() {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h" || arg === "help") {
    console.log(HELP);
    return;
  }
  if (arg && arg !== "once") {
    console.error(`Unknown command "${arg}"\n\n${HELP}`);
    process.exit(1);
  }

  const config = loadConfig();
  const notion = new NotionStore(config);
  const bp = new BulkPublishClient({
    apiKey: config.bulkpublishApiKey,
    baseUrl: config.bulkpublishBaseUrl,
  });
  const ctx = { config, notion, bp, log: (...a) => console.log(new Date().toISOString(), ...a) };

  if (arg === "once") {
    await runOnce(ctx);
    return;
  }

  console.log(`notion-bulkpublish: polling every ${config.pollIntervalMs / 1000}s (Ctrl+C to stop)`);
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    console.log("\nStopping after the current pass…");
  });
  while (!stopping) {
    try {
      await runOnce(ctx);
    } catch (err) {
      console.error(new Date().toISOString(), "[poll] error:", err.message);
    }
    if (stopping) break;
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
