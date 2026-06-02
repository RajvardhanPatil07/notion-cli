import {
  databaseManifestSchema,
  type DatabaseManifest,
  type PropertyManifest
} from "./schemas.js";
import { sortDeep } from "./stable.js";

type UnknownRecord = Record<string, unknown>;

export interface RemoteDataSourceBundle {
  dataSource: UnknownRecord;
  templates: UnknownRecord[];
}

export function normalizeDatabase(
  key: string,
  database: UnknownRecord,
  dataSources: RemoteDataSourceBundle[]
): DatabaseManifest {
  const manifest: DatabaseManifest = {
    version: 1,
    kind: "database",
    key,
    id: stringValue(database.id),
    title: textArrayToPlain(database.title),
    description: textArrayToPlain(database.description),
    parent: normalizeParent(database.parent),
    isInline: Boolean(database.is_inline),
    dataSources: dataSources.map(({ dataSource, templates }) => ({
      id: stringValue(dataSource.id),
      key: keyFromTitle(textArrayToPlain(dataSource.title) || stringValue(dataSource.id) || "data-source"),
      title: textArrayToPlain(dataSource.title),
      properties: normalizeProperties(dataSource.properties),
      templates: templates.map((template) => ({
        id: stringValue(template.id) ?? "",
        name: stringValue(template.name) ?? "",
        isDefault: Boolean(template.is_default)
      }))
    }))
  };

  return databaseManifestSchema.parse(manifest);
}

export function normalizeProperties(value: unknown): Record<string, PropertyManifest> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output: Record<string, PropertyManifest> = {};

  for (const [name, property] of Object.entries(value as UnknownRecord)) {
    if (!property || typeof property !== "object" || Array.isArray(property)) {
      continue;
    }

    const record = property as UnknownRecord;
    const type = stringValue(record.type);

    if (!type) {
      continue;
    }

    output[name] = sortDeep({
      id: stringValue(record.id),
      type,
      [type]: record[type] ?? {}
    });
  }

  return output;
}

export function textArrayToPlain(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const record = item as UnknownRecord;
      return stringValue(record.plain_text) ?? nestedTextContent(record);
    })
    .join("");
}

function nestedTextContent(record: UnknownRecord): string {
  const text = record.text;
  if (!text || typeof text !== "object" || Array.isArray(text)) {
    return "";
  }

  return stringValue((text as UnknownRecord).content) ?? "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeParent(value: unknown): DatabaseManifest["parent"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as UnknownRecord;
  if (record.type === "page_id" && typeof record.page_id === "string") {
    return {
      type: "page_id",
      page_id: record.page_id
    };
  }

  if (record.type === "workspace" && record.workspace === true) {
    return {
      type: "workspace",
      workspace: true
    };
  }

  if (record.type === "database_id" && typeof record.database_id === "string") {
    return {
      type: "database_id",
      database_id: record.database_id
    };
  }

  return undefined;
}

function keyFromTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "data-source";
}
