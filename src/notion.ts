import { Client } from "@notionhq/client";
import { DEFAULT_NOTION_VERSION } from "./constants.js";

export interface NotionProvider {
  retrieveDatabase(databaseId: string): Promise<Record<string, unknown>>;
  createDatabase(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateDatabase(databaseId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  retrieveDataSource(dataSourceId: string): Promise<Record<string, unknown>>;
  createDataSource(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateDataSource(dataSourceId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  listDataSourceTemplates(dataSourceId: string): Promise<Record<string, unknown>[]>;
}

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 300;

export class HttpNotionProvider implements NotionProvider {
  private readonly client: Client;

  constructor(token: string, notionVersion = DEFAULT_NOTION_VERSION) {
    this.client = new Client({ auth: token, notionVersion });
  }

  retrieveDatabase(databaseId: string) {
    return withRetry(() => this.client.databases.retrieve({ database_id: databaseId }) as unknown as Promise<Record<string, unknown>>);
  }

  createDatabase(payload: Record<string, unknown>) {
    return withRetry(() => this.client.databases.create(payload as never) as unknown as Promise<Record<string, unknown>>);
  }

  updateDatabase(databaseId: string, payload: Record<string, unknown>) {
    return withRetry(() => this.client.databases.update({ database_id: databaseId, ...payload } as never) as unknown as Promise<Record<string, unknown>>);
  }

  retrieveDataSource(dataSourceId: string) {
    return withRetry(() => this.dataSources().retrieve({ data_source_id: dataSourceId }));
  }

  createDataSource(payload: Record<string, unknown>) {
    return withRetry(() => this.dataSources().create(payload));
  }

  updateDataSource(dataSourceId: string, payload: Record<string, unknown>) {
    return withRetry(() => this.dataSources().update({ data_source_id: dataSourceId, ...payload }));
  }

  async listDataSourceTemplates(dataSourceId: string): Promise<Record<string, unknown>[]> {
    const templates: Record<string, unknown>[] = [];
    let startCursor: string | undefined;
    do {
      const response = await withRetry(() => this.dataSources().listTemplates({ data_source_id: dataSourceId, page_size: 100, start_cursor: startCursor }));
      templates.push(...(response.templates ?? []));
      startCursor = response.next_cursor ?? undefined;
      if (!response.has_more) break;
    } while (startCursor);
    return templates;
  }

  private dataSources(): {
    retrieve(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    create(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    update(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    listTemplates(input: Record<string, unknown>): Promise<{ templates?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string | null }>;
  } {
    return (this.client as unknown as { dataSources: ReturnType<HttpNotionProvider["dataSources"]> }).dataSources;
  }
}

export async function withRetry<T>(operation: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isRetryableError(error)) throw error;
      const retryAfter = retryAfterMs(error);
      const delay = retryAfter ?? BASE_DELAY_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

function isRetryableError(error: unknown): boolean {
  const status = statusCode(error);
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function statusCode(error: unknown): number {
  if (typeof error !== "object" || error === null) return 0;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : 0;
}

function retryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const headers = (error as { headers?: Record<string, unknown> }).headers;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  const seconds = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 30_000) : undefined;
}

export function richText(content: string): Array<Record<string, unknown>> {
  if (!content) return [];
  return [{ type: "text", text: { content } }];
}

export function propertyUpdatePayload(property: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(property)) {
    if (key === "id" || key === "name" || key === "type") continue;
    output[key] = value;
  }
  return output;
}
