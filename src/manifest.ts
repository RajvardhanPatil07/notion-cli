import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CliError } from "./errors.js";
import {
  databaseManifestSchema,
  type ConfigResource,
  type DatabaseManifest,
  type DataSourceManifest,
  type NotionCtlConfig,
  type PropertyManifest
} from "./schemas.js";
import { sortDeep } from "./stable.js";

export function manifestPath(
  cwd: string,
  config: NotionCtlConfig,
  resource: ConfigResource
): string {
  return path.join(
    cwd,
    config.outputDir,
    resource.manifest ?? `databases/${resource.key}.yaml`
  );
}

export function readManifest(
  cwd: string,
  config: NotionCtlConfig,
  resource: ConfigResource
): DatabaseManifest {
  return readManifestWithWarnings(cwd, config, resource).manifest;
}

export function readManifestWithWarnings(
  cwd: string,
  config: NotionCtlConfig,
  resource: ConfigResource
): { manifest: DatabaseManifest; warnings: string[] } {
  const file = manifestPath(cwd, config, resource);

  try {
    const parsed = YAML.parse(readFileSync(file, "utf8")) ?? {};
    return {
      manifest: databaseManifestSchema.parse(parsed),
      warnings: unsupportedManifestWarnings(resource.key, parsed)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(`Missing manifest for "${resource.key}" at ${file}. Run notionctl pull.`);
    }

    throw error;
  }
}

export function unsupportedManifestWarnings(resourceKey: string, value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const warnings: string[] = [];
  const record = value as Record<string, unknown>;

  if ("views" in record) {
    warnings.push(
      `Resource "${resourceKey}" declares views, but Notion view management is not supported by the public API. Views will be ignored.`
    );
  }

  if (Array.isArray(record.dataSources)) {
    for (const dataSource of record.dataSources) {
      if (!dataSource || typeof dataSource !== "object" || Array.isArray(dataSource)) {
        continue;
      }

      if ("views" in dataSource) {
        warnings.push(
          `Resource "${resourceKey}" declares data source views, but Notion view management is not supported by the public API. Views will be ignored.`
        );
      }
    }
  }

  return warnings;
}

export function writeManifest(
  cwd: string,
  config: NotionCtlConfig,
  resource: ConfigResource,
  manifest: DatabaseManifest
): void {
  const file = manifestPath(cwd, config, resource);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stringifyManifest(manifest), "utf8");
}

export function stringifyManifest(manifest: DatabaseManifest): string {
  return YAML.stringify(orderManifest(databaseManifestSchema.parse(manifest)), {
    indent: 2,
    lineWidth: 0
  });
}

export function orderManifest(manifest: DatabaseManifest): DatabaseManifest {
  return {
    version: manifest.version,
    kind: manifest.kind,
    key: manifest.key,
    id: manifest.id,
    title: manifest.title,
    description: manifest.description,
    parent: manifest.parent,
    isInline: manifest.isInline,
    dataSources: manifest.dataSources.map(orderDataSource)
  };
}

function orderDataSource(dataSource: DataSourceManifest): DataSourceManifest {
  const properties: Record<string, PropertyManifest> = {};

  for (const name of Object.keys(dataSource.properties).sort()) {
    properties[name] = sortDeep(dataSource.properties[name]);
  }

  return {
    id: dataSource.id,
    key: dataSource.key,
    title: dataSource.title,
    properties,
    templates: [...dataSource.templates].sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  };
}
