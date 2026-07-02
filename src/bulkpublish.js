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

  /** POST /api/posts — create a draft or scheduled post. */
  createPost(post) {
    return this.#request("POST", "/api/posts", { body: post });
  }

  /** POST /api/posts/{id}/publish — publish an existing draft now. */
  publishPost(id) {
    return this.#request("POST", `/api/posts/${id}/publish`);
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
