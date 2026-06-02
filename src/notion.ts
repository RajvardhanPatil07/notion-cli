import { Client } from "@notionhq/client";
import { DEFAULT_NOTION_VERSION } from "./constants.js";

export interface NotionProvider {
  retrieveDatabase(databaseId: string): Promise<Record<string, unknown>>;
  createDatabase(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateDatabase(
    databaseId: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  retrieveDataSource(dataSourceId: string): Promise<Record<string, unknown>>;
  createDataSource(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateDataSource(
    dataSourceId: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  listDataSourceTemplates(dataSourceId: string): Promise<Record<string, unknown>[]>;
}

export class HttpNotionProvider implements NotionProvider {
  private readonly client: Client;

  constructor(token: string, notionVersion = DEFAULT_NOTION_VERSION) {
    this.client = new Client({
      auth: token,
      notionVersion
    });
  }

  async retrieveDatabase(databaseId: string): Promise<Record<string, unknown>> {
    return (await this.client.databases.retrieve({
      database_id: databaseId
    })) as unknown as Record<string, unknown>;
  }

  async createDatabase(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await this.client.databases.create(payload as never)) as unknown as Record<
      string,
      unknown
    >;
  }

  async updateDatabase(
    databaseId: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return (await this.client.databases.update({
      database_id: databaseId,
      ...payload
    } as never)) as unknown as Record<string, unknown>;
  }

  async retrieveDataSource(dataSourceId: string): Promise<Record<string, unknown>> {
    const client = this.client as unknown as {
      dataSources: {
        retrieve(input: Record<string, unknown>): Promise<Record<string, unknown>>;
      };
    };

    return client.dataSources.retrieve({
      data_source_id: dataSourceId
    });
  }

  async createDataSource(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = this.client as unknown as {
      dataSources: {
        create(input: Record<string, unknown>): Promise<Record<string, unknown>>;
      };
    };

    return client.dataSources.create(payload);
  }

  async updateDataSource(
    dataSourceId: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const client = this.client as unknown as {
      dataSources: {
        update(input: Record<string, unknown>): Promise<Record<string, unknown>>;
      };
    };

    return client.dataSources.update({
      data_source_id: dataSourceId,
      ...payload
    });
  }

  async listDataSourceTemplates(dataSourceId: string): Promise<Record<string, unknown>[]> {
    const client = this.client as unknown as {
      dataSources: {
        listTemplates(input: Record<string, unknown>): Promise<{
          templates?: Record<string, unknown>[];
          has_more?: boolean;
          next_cursor?: string | null;
        }>;
      };
    };

    const templates: Record<string, unknown>[] = [];
    let startCursor: string | undefined;

    do {
      const response = await client.dataSources.listTemplates({
        data_source_id: dataSourceId,
        page_size: 100,
        start_cursor: startCursor
      });

      templates.push(...(response.templates ?? []));
      startCursor = response.next_cursor ?? undefined;

      if (!response.has_more) {
        break;
      }
    } while (startCursor);

    return templates;
  }
}

export function richText(content: string): Array<Record<string, unknown>> {
  if (!content) {
    return [];
  }

  return [
    {
      type: "text",
      text: {
        content
      }
    }
  ];
}

export function propertyUpdatePayload(
  property: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(property)) {
    if (key === "id" || key === "name" || key === "type") {
      continue;
    }

    output[key] = value;
  }

  return output;
}
