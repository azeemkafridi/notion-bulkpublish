import "dotenv/config";

/**
 * Configuration, loaded from environment variables (a local `.env` file is
 * picked up automatically via dotenv).
 *
 * Notion property names can be overridden with NOTION_PROP_* vars so the
 * service adapts to an existing database instead of the other way around.
 */
export function loadConfig(env = process.env) {
  const config = {
    notionToken: env.NOTION_TOKEN,
    notionDatabaseId: env.NOTION_DATABASE_ID,
    bulkpublishApiKey: env.BULKPUBLISH_API_KEY,
    bulkpublishBaseUrl: env.BULKPUBLISH_BASE_URL || "https://app.bulkpublish.com",
    pollIntervalMs: (Number(env.POLL_INTERVAL) || 60) * 1000,
    timezone: env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    properties: {
      caption: env.NOTION_PROP_CAPTION || "Caption",
      channels: env.NOTION_PROP_CHANNELS || "Channels",
      media: env.NOTION_PROP_MEDIA || "Media",
      schedule: env.NOTION_PROP_SCHEDULE || "Schedule",
      status: env.NOTION_PROP_STATUS || "Status",
      result: env.NOTION_PROP_RESULT || "Result",
      approval: env.NOTION_PROP_APPROVAL || "Request Approval",
    },
    // Hold every scheduled post for team approval, even when a row has no
    // "Request Approval" checkbox. Members whose role lacks post:publish
    // (contributors) are held server-side regardless of this setting.
    requestApproval: String(env.BULKPUBLISH_REQUEST_APPROVAL || "").toLowerCase() === "true",
    statusValues: {
      ready: env.NOTION_STATUS_READY || "Ready",
      posting: env.NOTION_STATUS_POSTING || "Posting",
      posted: env.NOTION_STATUS_POSTED || "Posted",
      failed: env.NOTION_STATUS_FAILED || "Failed",
    },
  };

  const missing = [];
  if (!config.notionToken) missing.push("NOTION_TOKEN");
  if (!config.notionDatabaseId) missing.push("NOTION_DATABASE_ID");
  if (!config.bulkpublishApiKey) missing.push("BULKPUBLISH_API_KEY");
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env and fill them in."
    );
  }
  if (!config.bulkpublishApiKey.startsWith("bp_")) {
    throw new Error(
      "BULKPUBLISH_API_KEY does not look like a BulkPublish key (expected it to start with \"bp_\"). " +
        "Create one at https://app.bulkpublish.com/developer"
    );
  }
  return config;
}
