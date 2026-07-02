import { captionHasUrl } from "./mapping.js";

/**
 * Cost + quota preview logic (pure — inputs are API responses).
 *
 * X (Twitter) pricing is credit-based in "dcents" ($1 = 1000 dcents):
 *   tweet_create           15 dcents
 *   tweet_create_with_url 200 dcents  (posts containing a link cost ~13x!)
 *   media_simple_upload     5 dcents per media file
 */
export const DEFAULT_X_COSTS = {
  tweet_create: 15,
  tweet_create_with_url: 200,
  media_simple_upload: 5,
};

export function formatDcents(dcents) {
  return `$${(dcents / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} (${dcents} dcents)`;
}

/**
 * Estimate the X credit cost for one post.
 * Returns 0 when no X channel is targeted.
 */
export function estimateXCostDcents({ caption, mediaCount, targetChannels, xCosts = DEFAULT_X_COSTS }) {
  const targetsX = targetChannels.some((c) => c.platform === "x");
  if (!targetsX) return 0;
  const costs = { ...DEFAULT_X_COSTS, ...xCosts };
  const base = captionHasUrl(caption) ? costs.tweet_create_with_url : costs.tweet_create;
  return base + mediaCount * costs.media_simple_upload;
}

/**
 * Build the pre-publish preview:
 *   - one human-readable log line
 *   - a refusal message when the daily/monthly post quota is exhausted
 *
 * quota:  GET /api/quotas/usage  → { plan, limits, usage }
 * xUsage: GET /api/quotas/x-usage → { credits: { balanceDcents }, costs } (nullable)
 */
export function buildCostPreview({ caption, mediaCount, targetChannels, quota, xUsage }) {
  const parts = [];
  let refusal = null;

  const limits = quota?.limits || {};
  const usage = quota?.usage || {};
  // Limits are -1 on unlimited plans (business) — display ∞ and never refuse.
  if (limits.postsPerDay != null) {
    const unlimited = limits.postsPerDay < 0;
    parts.push(`posts today ${usage.postsToday ?? 0}/${unlimited ? "∞" : limits.postsPerDay}`);
    if (!unlimited && (usage.postsToday ?? 0) >= limits.postsPerDay) {
      refusal = `Daily post quota exhausted (${usage.postsToday}/${limits.postsPerDay} on the ${quota.plan ?? "current"} plan). Try again tomorrow or upgrade at https://app.bulkpublish.com/settings/billing`;
    }
  }
  if (limits.postsPerMonth != null) {
    const unlimited = limits.postsPerMonth < 0;
    parts.push(`posts this month ${usage.postsThisMonth ?? 0}/${unlimited ? "∞" : limits.postsPerMonth}`);
    if (!refusal && !unlimited && (usage.postsThisMonth ?? 0) >= limits.postsPerMonth) {
      refusal = `Monthly post quota exhausted (${usage.postsThisMonth}/${limits.postsPerMonth} on the ${quota.plan ?? "current"} plan). Upgrade at https://app.bulkpublish.com/settings/billing`;
    }
  }

  const estXCost = estimateXCostDcents({
    caption,
    mediaCount,
    targetChannels,
    xCosts: xUsage?.costs,
  });
  if (estXCost > 0) {
    const withUrl = captionHasUrl(caption);
    parts.push(
      `est. X cost ${formatDcents(estXCost)}${withUrl ? " — caption contains a URL (13x plain-text price)" : ""}`
    );
    if (xUsage?.credits?.balanceDcents != null) {
      parts.push(`X balance ${formatDcents(xUsage.credits.balanceDcents)}`);
      if (xUsage.credits.balanceDcents < estXCost) {
        parts.push("WARNING: X credit balance may be insufficient");
      }
    }
  }

  return { line: `[quota] ${parts.join(" | ")}`, refusal, estXCostDcents: estXCost };
}
