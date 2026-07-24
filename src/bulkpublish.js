/**
 * Minimal BulkPublish API client (native fetch, Node 18+).
 * Base: https://app.bulkpublish.com, auth: `Authorization: Bearer bp_<key>`.
 */
export class BulkPublishClient {
  constructor({ apiKey, baseUrl = "https://app.bulkpublish.com", fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  async #request(method, path, { body, formData } = {}) {
    const headers = { Authorization: `Bearer ${this.apiKey}` };
    let payload;
    if (formData) {
      payload = formData; // fetch sets the multipart boundary itself
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await this.fetch(`${this.baseUrl}${path}`, { method, headers, body: payload });
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const message = data?.error?.message || text || res.statusText;
      const code = data?.error?.code;
      const err = new Error(`BulkPublish API ${res.status}: ${message}${code ? ` (${code})` : ""}`);
      err.status = res.status;
      err.code = code;
      throw err;
    }
    return data;
  }

  /** GET /api/channels → [{ id, platform, accountName, isActive, tokenStatus }] */
  async listChannels() {
    const data = await this.#request("GET", "/api/channels");
    return data.channels || [];
  }

  /**
   * GET /api/channel-sets → [{ id, name, channelIds, ... }] ordered by name.
   * Channel sets are saved channel groups for one-click targeting
   * (max 50 sets per org; names unique per org).
   * Returns [] on error so channel resolution still works without sets.
   */
  async listChannelSets() {
    try {
      const data = await this.#request("GET", "/api/channel-sets");
      return Array.isArray(data) ? data : [];
    } catch {
      return []; // non-fatal: set targeting is optional
    }
  }

  /** POST /api/posts — create a draft or scheduled post. */
  createPost(post) {
    return this.#request("POST", "/api/posts", { body: post });
  }

  /**
   * POST /api/posts/{id}/publish — publish an existing draft now.
   * Requires a role with post:publish — contributors get 403 APPROVAL_REQUIRED
   * and must submit the post for approval instead (create with
   * `requestApproval: true`, then a teammate approves).
   */
  publishPost(id) {
    return this.#request("POST", `/api/posts/${id}/publish`);
  }

  /**
   * GET /api/posts → posts. Supports the optional approvalStatus filter
   * (none | pending | approved | rejected).
   */
  async listPosts({ approvalStatus, status, limit } = {}) {
    const qs = new URLSearchParams();
    if (approvalStatus) qs.set("approvalStatus", approvalStatus);
    if (status) qs.set("status", status);
    if (limit) qs.set("limit", String(limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    const data = await this.#request("GET", `/api/posts${suffix}`);
    return data?.posts || (Array.isArray(data) ? data : []);
  }

  /**
   * POST /api/posts/{id}/approve — requires a role with post:approve (owner,
   * admin, approver). Releases a post with approvalStatus 'pending': it
   * publishes at its scheduled time, or immediately if that time has already
   * passed. The author is notified in-app.
   */
  approvePost(id) {
    return this.#request("POST", `/api/posts/${id}/approve`);
  }

  /**
   * POST /api/posts/{id}/reject — requires a role with post:approve. The post
   * returns to draft with approvalStatus 'rejected' and the optional reason
   * (max 2000 chars); the author is notified and can edit + reschedule to
   * resubmit for approval.
   */
  rejectPost(id, reason) {
    return this.#request("POST", `/api/posts/${id}/reject`, {
      body: reason ? { reason: String(reason).slice(0, 2000) } : {},
    });
  }

  /** GET /api/posts/{id} → includes postPlatforms: [{ platform, status, errorMessage, platformUrl }] */
  getPost(id) {
    return this.#request("GET", `/api/posts/${id}`);
  }

  /**
   * POST /api/media (multipart, field `file`) → media id.
   * Accepts a Buffer/Uint8Array plus filename and content type.
   */
  async uploadMedia(bytes, filename, contentType) {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([bytes], { type: contentType || "application/octet-stream" }),
      filename
    );
    const data = await this.#request("POST", "/api/media", { formData });
    return data.file;
  }

  /** GET /api/quotas/usage → { plan, limits, usage } */
  getQuotaUsage() {
    return this.#request("GET", "/api/quotas/usage");
  }

  /** GET /api/quotas/x-usage → { credits: { balanceDcents }, costs } (X/Twitter credits). */
  async getXUsage() {
    try {
      return await this.#request("GET", "/api/quotas/x-usage");
    } catch {
      return null; // non-fatal: cost preview just skips X credit info
    }
  }
}
