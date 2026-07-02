import { Client } from "@notionhq/client";

/** Thin wrapper around the Notion SDK for our database operations. */
export class NotionStore {
  constructor(config) {
    this.config = config;
    this.client = new Client({ auth: config.notionToken });
  }

  /**
   * Query pages whose Status property equals "Ready".
   * Tries a `select` filter first, falls back to `status` (both property
   * kinds are common for a "Status" column).
   */
  async findReadyPages() {
    const { status } = this.config.properties;
    const { ready } = this.config.statusValues;
    const query = (filter) =>
      this.client.databases.query({
        database_id: this.config.notionDatabaseId,
        filter,
        page_size: 25,
      });
    try {
      const res = await query({ property: status, select: { equals: ready } });
      return res.results;
    } catch (err) {
      if (!/select|property type|validation/i.test(err.message)) throw err;
      const res = await query({ property: status, status: { equals: ready } });
      return res.results;
    }
  }

  /** Detect whether the Status property is a `select` or `status` type on a page. */
  #statusPayload(page, value) {
    const prop = page.properties?.[this.config.properties.status];
    if (prop?.type === "status") return { status: { name: value } };
    return { select: { name: value } };
  }

  /** Detect whether the Result property is rich_text or url. */
  #resultPayload(page, text) {
    const prop = page.properties?.[this.config.properties.result];
    if (prop?.type === "url") {
      const match = text.match(/https?:\/\/\S+/);
      return { url: match ? match[0] : null };
    }
    // Notion rich_text blocks cap at 2000 chars each
    return { rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }] };
  }

  /** Flip Status (and optionally write Result) on a page. */
  async updatePage(page, { status, result }) {
    const properties = {};
    if (status) properties[this.config.properties.status] = this.#statusPayload(page, status);
    if (result !== undefined && page.properties?.[this.config.properties.result]) {
      properties[this.config.properties.result] = this.#resultPayload(page, result);
    }
    await this.client.pages.update({ page_id: page.id, properties });
  }
}
