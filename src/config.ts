import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  CONFIG_FILE,
  DEFAULT_NOTION_VERSION,
  DEFAULT_OUTPUT_DIR,
  LOCK_FILE
} from "./constants.js";
import { CliError } from "./errors.js";
import {
  configSchema,
  type ConfigResource,
  type NotionCtlConfig,
  type NotionCtlLock,
  lockSchema
} from "./schemas.js";

export function defaultConfig(): NotionCtlConfig {
  return {
    version: 1,
    outputDir: DEFAULT_OUTPUT_DIR,
    defaults: {
      notionVersion: DEFAULT_NOTION_VERSION
    },
    resources: []
  };
}

export function configPath(cwd: string): string {
  return path.join(cwd, CONFIG_FILE);
}

export function loadConfig(cwd: string, required = true): NotionCtlConfig {
  const file = configPath(cwd);

  if (!existsSync(file)) {
    if (required) {
      throw new CliError(`Missing ${CONFIG_FILE}. Run notionctl init first.`);
    }

    return defaultConfig();
  }

  const parsed = YAML.parse(readFileSync(file, "utf8")) ?? {};
  return configSchema.parse(parsed);
}

export function saveConfig(cwd: string, config: NotionCtlConfig): void {
  const file = configPath(cwd);
  const document = YAML.stringify(configSchema.parse(config), {
    indent: 2,
    lineWidth: 0
  });

  writeFileSync(file, document, "utf8");
}

export function upsertResource(
  config: NotionCtlConfig,
  resource: ConfigResource
): NotionCtlConfig {
  const next = structuredClone(config);
  const existingIndex = next.resources.findIndex((item) => item.key === resource.key);
  const normalized = {
    ...resource,
    manifest: resource.manifest ?? `databases/${resource.key}.yaml`
  };

  if (existingIndex >= 0) {
    next.resources[existingIndex] = {
      ...next.resources[existingIndex],
      ...normalized
    };
  } else {
    next.resources.push(normalized);
  }

  next.resources.sort((left, right) => left.key.localeCompare(right.key));
  return configSchema.parse(next);
}

export function selectResources(
  config: NotionCtlConfig,
  resourceKey?: string
): ConfigResource[] {
  if (!resourceKey) {
    return config.resources;
  }

  const resource = config.resources.find((item) => item.key === resourceKey);
  if (!resource) {
    throw new CliError(`Unknown resource "${resourceKey}" in ${CONFIG_FILE}.`);
  }

  return [resource];
}

export function ensureOutputDirs(cwd: string, config: NotionCtlConfig): void {
  mkdirSync(path.join(cwd, config.outputDir, "databases"), { recursive: true });
}

export function lockPath(cwd: string, config: NotionCtlConfig): string {
  return path.join(cwd, config.outputDir, LOCK_FILE);
}

export function loadLock(cwd: string, config: NotionCtlConfig): NotionCtlLock {
  const file = lockPath(cwd, config);

  if (!existsSync(file)) {
    return {
      version: 1,
      resources: {}
    };
  }

  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  return lockSchema.parse(parsed);
}

export function saveLock(
  cwd: string,
  config: NotionCtlConfig,
  lock: NotionCtlLock
): void {
  ensureOutputDirs(cwd, config);
  writeFileSync(lockPath(cwd, config), `${JSON.stringify(lockSchema.parse(lock), null, 2)}\n`);
}

export function resolveDatabaseId(
  resource: ConfigResource,
  manifestId: string | undefined,
  lock: NotionCtlLock
): string | undefined {
  return resource.databaseId ?? manifestId ?? lock.resources[resource.key]?.databaseId;
}

export function updateLockFromManifest(
  lock: NotionCtlLock,
  manifest: {
    key: string;
    id?: string;
    dataSources: Array<{ key: string; id?: string }>;
  }
): NotionCtlLock {
  const next = structuredClone(lock);
  const current = next.resources[manifest.key] ?? { dataSources: {} };

  if (manifest.id) {
    current.databaseId = manifest.id;
  }

  for (const dataSource of manifest.dataSources) {
    if (dataSource.id) {
      current.dataSources[dataSource.key] = dataSource.id;
    }
  }

  next.resources[manifest.key] = current;
  return lockSchema.parse(next);
}

export function parseDotEnv(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

export function resolveToken(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (env.NOTION_TOKEN) {
    return env.NOTION_TOKEN;
  }

  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) {
    return undefined;
  }

  return parseDotEnv(readFileSync(envPath, "utf8")).NOTION_TOKEN;
}
