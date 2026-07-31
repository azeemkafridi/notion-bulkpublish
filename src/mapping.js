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
 * property names. Returns { caption, channelNames, mediaFiles, scheduledAt,
 * status, requestApproval }.
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

  // Optional "Request Approval" column: holds the scheduled post for team
  // approval (approvalStatus becomes "pending") instead of publishing it.
  const approvalProp = props[propNames.approval];
  let requestApproval = false;
  if (approvalProp?.type === "checkbox") {
    requestApproval = Boolean(approvalProp.checkbox);
  } else if (approvalProp?.type === "select") {
    requestApproval = /^(yes|true|required?)$/i.test(approvalProp.select?.name || "");
  }

  // Optional "Link Tracking" column. Tri-state, unlike the approval flag: true
  // forces bulkpubli.sh shortening for this row, false forces plain links, and
  // null (no column, or an empty/unrecognised select) inherits the organization
  // setting. A checkbox can only express two of those, so an unticked checkbox
  // is read as "inherit" rather than "off" — use a select to force it off.
  const linkProp = props[propNames.linkTracking];
  let linkTrackingOverride = null;
  if (linkProp?.type === "checkbox") {
    linkTrackingOverride = linkProp.checkbox ? true : null;
  } else if (linkProp?.type === "select") {
    const v = (linkProp.select?.name || "").trim();
    if (/^(on|yes|true|enabled?)$/i.test(v)) linkTrackingOverride = true;
    else if (/^(off|no|false|disabled?)$/i.test(v)) linkTrackingOverride = false;
  }

  return {
    caption: caption.trim(),
    channelNames,
    mediaFiles,
    scheduledAt,
    status,
    requestApproval,
    linkTrackingOverride,
  };
}

/**
 * Resolve the Channels multi-select values against GET /api/channels.
 * Each value may be a channel ID, a platform name ("x", "linkedin", ...) —
 * which selects ALL active channels for that platform — an account name, or a
 * **channel set** name (GET /api/channel-sets — saved channel groups for
 * one-click targeting; max 50 sets per org, names unique per org), which
 * expands to every active channel in the set's channelIds.
 * Throws with a descriptive message when a value matches nothing.
 */
export function resolveChannels(channelNames, channels, channelSets = []) {
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
    const set = channelSets.find((s) => (s.name || "").toLowerCase() === lower);
    const bySet = set
      ? active.filter((c) => (set.channelIds || []).some((id) => String(id) === String(c.id)))
      : [];

    const matches = byId ? [byId] : byPlatform.length ? byPlatform : byAccount.length ? byAccount : bySet;
    if (!matches.length) {
      if (set) {
        throw new Error(
          `Channel set "${set.name}" matched, but none of its channels are active/connected. ` +
            `Review the set at https://app.bulkpublish.com/channels.`
        );
      }
      const available = [...new Set(active.map((c) => `${c.platform} (${c.accountName})`))];
      const setNames = channelSets.map((s) => s.name);
      throw new Error(
        `Channel "${value}" not found. Use a platform name, account name, channel ID, or channel set name. ` +
          `Connected channels: ${available.join(", ") || "none"}.` +
          (setNames.length ? ` Channel sets: ${setNames.join(", ")}` : "")
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
