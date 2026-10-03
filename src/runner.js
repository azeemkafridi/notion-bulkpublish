import { extractRow, resolveChannels, checkCharLimits, buildPostBody, resolveDiscordChannel } from "./mapping.js";
import { buildCostPreview } from "./cost.js";

const POLL_STATUS_ATTEMPTS = 15;
const POLL_STATUS_DELAY_MS = 4000;
const PENDING_STATUSES = new Set(["pending", "publishing", "processing"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pageTitle(row) {
  return row.caption ? `"${row.caption.slice(0, 40)}${row.caption.length > 40 ? "…" : ""}"` : "(no caption)";
}

/**
 * One pass over the Notion database: find Ready rows and publish each.
 * Returns the number of rows processed.
 */
export async function runOnce({ config, notion, bp, log = console.log }) {
  const pages = await notion.findReadyPages();
  if (!pages.length) {
    log("[poll] no rows with Status = " + JSON.stringify(config.statusValues.ready));
    return 0;
  }
  log(`[poll] found ${pages.length} ready row(s)`);
  for (const page of pages) {
    await processPage({ config, notion, bp, page, log });
  }
  return pages.length;
}

/** Publish a single Notion row; writes Status + Result back whatever happens. */
export async function processPage({ config, notion, bp, page, log = console.log }) {
  const row = extractRow(page, config.properties);
  log(`[row] ${pageTitle(row)}`);

  const fail = async (message) => {
    log(`[row] FAILED: ${message}`);
    await notion.updatePage(page, { status: config.statusValues.failed, result: message });
  };

  try {
    // --- Validate the row ---------------------------------------------------
    if (!row.caption) return await fail("Caption is empty — add post text before setting Status to Ready.");
    if (!row.channelNames.length) return await fail("No channels selected — add at least one platform/channel to the Channels property.");

    const [channels, channelSets] = await Promise.all([bp.listChannels(), bp.listChannelSets()]);
    const targetChannels = resolveChannels(row.channelNames, channels, channelSets);

    const limitError = checkCharLimits(row.caption, targetChannels);
    if (limitError) return await fail(limitError);

    // Discord posts into one text channel of the connected server; pick it
    // before anything is uploaded or created.
    // Keyed by platform, then by BulkPublish channel id.
    const platformSpecific = {};
    for (const c of targetChannels.filter((t) => t.platform === "discord")) {
      const wanted = row.discordChannel || config.discordChannel;
      const options = wanted || !c.metadata?.channelId ? await bp.getChannelOptions(c.id) : [];
      const discordId = resolveDiscordChannel(wanted, c, options);
      if (discordId) (platformSpecific.discord ||= {})[c.id] = { channelId: discordId };
    }

    // --- Cost / quota preview ------------------------------------------------
    const targetsX = targetChannels.some((c) => c.platform === "x");
    const [quota, xUsage] = await Promise.all([
      bp.getQuotaUsage(),
      targetsX ? bp.getXUsage() : Promise.resolve(null),
    ]);
    const preview = buildCostPreview({
      caption: row.caption,
      mediaCount: row.mediaFiles.length,
      targetChannels,
      quota,
      xUsage,
    });
    log(preview.line);
    if (preview.refusal) return await fail(preview.refusal);

    // --- Claim the row so a second pass can't double-post --------------------
    await notion.updatePage(page, { status: config.statusValues.posting });

    // --- Media: download from Notion, upload to BulkPublish -------------------
    const mediaIds = [];
    for (const file of row.mediaFiles) {
      log(`[media] downloading ${file.name}`);
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`Failed to download media "${file.name}" from Notion (HTTP ${res.status})`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "application/octet-stream";
      const uploaded = await bp.uploadMedia(bytes, file.name, contentType);
      mediaIds.push(uploaded.id);
      log(`[media] uploaded ${file.name} → ${uploaded.id}`);
    }

    // --- Create + publish ------------------------------------------------------
    const scheduled = Boolean(row.scheduledAt);
    const requestApproval = Boolean(row.requestApproval || config.requestApproval);
    // Row wins over the run-wide default. Both are tri-state, so this tests for
    // null rather than falsiness — `false` is a deliberate "off", not "unset".
    const linkTracking = row.linkTrackingOverride ?? config.linkTracking;
    const post = await bp.createPost(
      buildPostBody({
        caption: row.caption,
        channelIds: targetChannels.map((c) => c.id),
        mediaIds,
        scheduledAt: row.scheduledAt || null,
        timezone: config.timezone,
        requestApproval,
        linkTracking: linkTracking ?? null,
        platformSpecific,
      })
    );

    if (scheduled) {
      const platforms = targetChannels.map((c) => c.platform).join(", ");
      const msg =
        post.approvalStatus === "pending"
          ? `Waiting for approval — scheduled for ${row.scheduledAt} (post ${post.id}) → ${platforms}. ` +
            `A teammate with the approver role must approve it at https://app.bulkpublish.com/posts before it publishes.`
          : `Scheduled for ${row.scheduledAt} (post ${post.id}) → ${platforms}`;
      log(`[row] ${msg}`);
      await notion.updatePage(page, { status: config.statusValues.posted, result: msg });
      return;
    }

    // An unscheduled row held for approval was submitted scheduled for now.
    if (post.approvalStatus === "pending") {
      const msg =
        `Post ${post.id} is awaiting team approval (approvalStatus "pending") and will not publish until ` +
        `a teammate with the approver role approves it at https://app.bulkpublish.com/posts. It publishes ` +
        `as soon as it is approved.`;
      log(`[row] ${msg}`);
      await notion.updatePage(page, { status: config.statusValues.posted, result: msg });
      return;
    }

    try {
      await bp.publishPost(post.id);
    } catch (err) {
      if (err.code === "APPROVAL_REQUIRED" || err.status === 403) {
        return await fail(
          "Your role can't publish directly — submit for approval instead. " +
            `Tick the "${config.properties.approval}" column (or set BULKPUBLISH_REQUEST_APPROVAL=true), ` +
            `then a teammate with the approver role approves it (post ${post.id} was left as a draft).`
        );
      }
      throw err;
    }
    const outcome = await waitForOutcome(bp, post.id, log);
    if (outcome.failed.length && !outcome.succeeded.length) {
      return await fail(outcome.summary);
    }
    await notion.updatePage(page, {
      status: outcome.failed.length ? config.statusValues.failed : config.statusValues.posted,
      result: outcome.summary,
    });
    log(`[row] done: ${outcome.summary}`);
  } catch (err) {
    await fail(err.message).catch((e) => log(`[row] could not write failure back to Notion: ${e.message}`));
  }
}

/** Poll GET /api/posts/{id} until every platform settles (or we time out). */
async function waitForOutcome(bp, postId, log) {
  let platforms = [];
  for (let i = 0; i < POLL_STATUS_ATTEMPTS; i++) {
    await sleep(POLL_STATUS_DELAY_MS);
    const post = await bp.getPost(postId);
    platforms = post.postPlatforms || [];
    if (platforms.length && !platforms.some((p) => PENDING_STATUSES.has(p.status))) break;
    log(`[status] waiting… (${platforms.map((p) => `${p.platform}:${p.status}`).join(", ") || "no platforms yet"})`);
  }

  const succeeded = platforms.filter((p) => p.status === "published");
  // "unconfirmed": the request may have reached the platform but no answer came
  // back. Never report it as posted, and warn before a retry duplicates it.
  const failed = platforms.filter((p) => p.status === "failed" || p.status === "unconfirmed");
  const parts = [];
  for (const p of succeeded) parts.push(`${p.platform}: ${p.platformUrl || "published"}`);
  for (const p of failed) {
    if (p.status === "unconfirmed") {
      parts.push(
        `${p.platform} UNCONFIRMED: the platform did not confirm the post. Check the account before retrying, or it may be posted twice.`
      );
    } else {
      parts.push(`${p.platform} FAILED: ${p.errorMessage || "unknown error"}`);
    }
  }
  const stillPending = platforms.filter((p) => !succeeded.includes(p) && !failed.includes(p));
  for (const p of stillPending) parts.push(`${p.platform}: still ${p.status} (check https://app.bulkpublish.com/posts)`);
  return {
    succeeded,
    failed,
    summary: parts.join("\n") || `Published (post ${postId})`,
  };
}
