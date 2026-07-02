/**
 * Pure mapping logic: Notion page properties → BulkPublish post inputs.
 * No I/O here so everything is unit-testable.
 */

/** Per-platform caption character limits (client-side guard). */
export const CHAR_LIMITS = {
  x: 280,
  threads: 500,
  bluesky: 300,
  mastodon: 500,
  pinterest: 500,
  gmb: 1500,
  linkedin: 3000,
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  facebook: 63206,
};

const URL_RE = /https?:\/\/\S+/i;

/** Join a Notion rich_text/title array into plain text. */
export function richTextToPlain(items = []) {
  return items.map((t) => t.plain_text ?? "").join("");
}

/**
 * Extract the fields we care about from a Notion page, using the configured
 * property names. Returns { caption, channelNames, mediaFiles, scheduledAt, status }.
 */
export function extractRow(page, propNames) {
  const props = page.properties || {};

  const captionProp = props[propNames.caption];
  let caption = "";
  if (captionProp?.type === "title") caption = richTextToPlain(captionProp.title);
  else if (captionProp?.type === "rich_text") caption = richTextToPlain(captionProp.rich_text);

  const channelsProp = props[propNames.channels];
  let channelNames = [];
  if (channelsProp?.type === "multi_select") {
    channelNames = channelsProp.multi_select.map((o) => o.name);
  } else if (channelsProp?.type === "select" && channelsProp.select) {
    channelNames = [channelsProp.select.name];
  } else if (channelsProp?.type === "rich_text") {
    channelNames = richTextToPlain(channelsProp.rich_text)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const mediaProp = props[propNames.media];
  const mediaFiles = (mediaProp?.type === "files" ? mediaProp.files : []).map((f) => ({
    name: f.name,
    url: f.type === "external" ? f.external?.url : f.file?.url,
  })).filter((f) => f.url);

  const scheduleProp = props[propNames.schedule];
  const scheduledAt = scheduleProp?.type === "date" && scheduleProp.date?.start
    ? scheduleProp.date.start
    : null;

  const statusProp = props[propNames.status];
  const status =
    statusProp?.type === "select" ? statusProp.select?.name ?? null
    : statusProp?.type === "status" ? statusProp.status?.name ?? null
    : null;

  return { caption: caption.trim(), channelNames, mediaFiles, scheduledAt, status };
}

/**
 * Resolve the Channels multi-select values against GET /api/channels.
 * Each value may be a channel ID, a platform name ("x", "linkedin", ...) —
 * which selects ALL active channels for that platform — or an account name.
 * Throws with a descriptive message when a value matches nothing.
 */
export function resolveChannels(channelNames, channels) {
  const active = channels.filter((c) => c.isActive !== false);
  const resolved = new Map(); // id → channel

  for (const raw of channelNames) {
    const value = String(raw).trim();
    const lower = value.toLowerCase();
    const byId = active.find((c) => String(c.id) === value);
    const byPlatform = active.filter((c) => (c.platform || "").toLowerCase() === lower);
    const byAccount = active.filter(
      (c) => (c.accountName || "").toLowerCase() === lower
    );

    const matches = byId ? [byId] : byPlatform.length ? byPlatform : byAccount;
    if (!matches.length) {
      const available = [...new Set(active.map((c) => `${c.platform} (${c.accountName})`))];
      throw new Error(
        `Channel "${value}" not found. Use a platform name, account name, or channel ID. ` +
          `Connected channels: ${available.join(", ") || "none"}`
      );
    }
    for (const c of matches) resolved.set(c.id, c);
  }
  return [...resolved.values()];
}

/**
 * Client-side character-limit check. Returns null when OK, otherwise the
 * exact failure message to write back to Notion.
 */
export function checkCharLimits(caption, targetChannels) {
  const length = [...caption].length;
  const violations = [];
  for (const platform of new Set(targetChannels.map((c) => c.platform))) {
    const limit = CHAR_LIMITS[platform];
    if (limit && length > limit) violations.push(`${platform} allows ${limit}`);
  }
  if (!violations.length) return null;
  return `Caption is ${length} characters, over the limit: ${violations.join(", ")}. Shorten the caption or remove the channel.`;
}

/** Does the caption contain a link? (X charges ~13x for posts with URLs.) */
export function captionHasUrl(caption) {
  return URL_RE.test(caption);
}
