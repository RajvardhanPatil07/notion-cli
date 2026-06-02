import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import type { NotionProvider } from "../src/notion.js";
import type { DatabaseManifest } from "../src/schemas.js";
import { stringifyManifest } from "../src/manifest.js";

export function tempWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "notionctl-"));
}

export function writeConfig(cwd: string): void {
  writeFileSync(
    path.join(cwd, "notionctl.yaml"),
    YAML.stringify({
      version: 1,
      outputDir: "notion",
      defaults: {
        notionVersion: "2026-03-11"
      },
      resources: [
        {
          key: "tasks",
          databaseId: "db1",
          manifest: "databases/tasks.yaml"
        }
      ]
    }),
    "utf8"
  );
}

export function writeDatabaseManifest(cwd: string, manifest: DatabaseManifest): void {
  const directory = path.join(cwd, "notion", "databases");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "tasks.yaml"), stringifyManifest(manifest), "utf8");
}

export class FakeNotionProvider implements NotionProvider {
  database: Record<string, unknown>;
  dataSource: Record<string, unknown>;
  templates: Record<string, unknown>[] = [];
  updates: Array<{ kind: string; id: string; payload: Record<string, unknown> }> = [];
  creates: Array<{ kind: string; payload: Record<string, unknown> }> = [];

  constructor() {
    this.database = {
      id: "db1",
      title: [{ plain_text: "Tasks" }],
      description: [],
      parent: {
        type: "page_id",
        page_id: "page1"
      },
      is_inline: false,
      data_sources: [{ id: "ds1", name: "Tasks" }]
    };
    this.dataSource = {
      id: "ds1",
      title: [{ plain_text: "Tasks" }],
      properties: {
        Name: {
          id: "title",
          type: "title",
          title: {}
        }
      }
    };
  }

  async retrieveDatabase(): Promise<Record<string, unknown>> {
    return this.database;
  }

  async createDatabase(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.creates.push({ kind: "database", payload });
    return { id: "created-db" };
  }

  async updateDatabase(
    id: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    this.updates.push({ kind: "database", id, payload });
    return { id };
  }

  async retrieveDataSource(): Promise<Record<string, unknown>> {
    return this.dataSource;
  }

  async createDataSource(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.creates.push({ kind: "dataSource", payload });
    return { id: "created-ds" };
  }

  async updateDataSource(
    id: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    this.updates.push({ kind: "dataSource", id, payload });
    return { id };
  }

  async listDataSourceTemplates(): Promise<Record<string, unknown>[]> {
    return this.templates;
  }
}

export function desiredTasksManifest(): DatabaseManifest {
  return {
    version: 1,
    kind: "database",
    key: "tasks",
    id: "db1",
    title: "Tasks",
    description: "",
    parent: {
      type: "page_id",
      page_id: "page1"
    },
    isInline: false,
    dataSources: [
      {
        id: "ds1",
        key: "tasks",
        title: "Tasks",
        properties: {
          Name: {
            id: "title",
            type: "title",
            title: {}
          },
          Status: {
            type: "select",
            select: {
              options: [
                {
                  name: "Todo",
                  color: "red"
                }
              ]
            }
          }
        },
        templates: []
      }
    ]
  };
}
