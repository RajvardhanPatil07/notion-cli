import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CONFIG_FILE, DEFAULT_NOTION_VERSION, DEFAULT_OUTPUT_DIR, LOCK_FILE } from "./constants.js";
import { CliError } from "./errors.js";
import { configSchema, type ConfigResource, type NotionCtlConfig, type NotionCtlLock, lockSchema } from "./schemas.js";

export function defaultConfig(): NotionCtlConfig {
  return { version: 1, outputDir: DEFAULT_OUTPUT_DIR, defaults: { notionVersion: DEFAULT_NOTION_VERSION }, resources: [] };
}
export function configPath(cwd: string): string { return path.join(cwd, CONFIG_FILE); }
export function loadConfig(cwd: string, required = true): NotionCtlConfig {
  const file = configPath(cwd);
  if (!existsSync(file)) {
    if (required) throw new CliError(`Missing ${CONFIG_FILE}. Run notionctl init first.`);
    return defaultConfig();
  }
  return configSchema.parse(YAML.parse(readFileSync(file, "utf8")) ?? {});
}
export function saveConfig(cwd: string, config: NotionCtlConfig): void {
  writeFileSync(configPath(cwd), YAML.stringify(configSchema.parse(config), { indent: 2, lineWidth: 0 }), "utf8");
}
export function upsertResource(config: NotionCtlConfig, resource: ConfigResource): NotionCtlConfig {
  const next = structuredClone(config);
  const index = next.resources.findIndex((item) => item.key === resource.key);
  const normalized = { ...resource, manifest: resource.manifest ?? `databases/${resource.key}.yaml` };
  if (index >= 0) next.resources[index] = { ...next.resources[index], ...normalized };
  else next.resources.push(normalized);
  next.resources.sort((a, b) => a.key.localeCompare(b.key));
  return configSchema.parse(next);
}
export function selectResources(config: NotionCtlConfig, resourceKey?: string): ConfigResource[] {
  if (!resourceKey) return config.resources;
  const resource = config.resources.find((item) => item.key === resourceKey);
  if (!resource) throw new CliError(`Unknown resource "${resourceKey}" in ${CONFIG_FILE}.`);
  return [resource];
}
export function ensureOutputDirs(cwd: string, config: NotionCtlConfig): void {
  mkdirSync(path.join(cwd, config.outputDir, "databases"), { recursive: true });
}
export function lockPath(cwd: string, config: NotionCtlConfig): string { return path.join(cwd, config.outputDir, LOCK_FILE); }
export function loadLock(cwd: string, config: NotionCtlConfig): NotionCtlLock {
  const file = lockPath(cwd, config);
  if (!existsSync(file)) return { version: 1, resources: {} };
  return lockSchema.parse(JSON.parse(readFileSync(file, "utf8")) as unknown);
}
export function saveLock(cwd: string, config: NotionCtlConfig, lock: NotionCtlLock): void {
  ensureOutputDirs(cwd, config);
  writeFileSync(lockPath(cwd, config), `${JSON.stringify(lockSchema.parse(lock), null, 2)}\n`);
}
export function resolveDatabaseId(resource: ConfigResource, manifestId: string | undefined, lock: NotionCtlLock): string | undefined {
  return resource.databaseId ?? manifestId ?? lock.resources[resource.key]?.databaseId;
}
export function updateLockFromManifest(lock: NotionCtlLock, manifest: { key: string; id?: string; dataSources: Array<{ key: string; id?: string }> }): NotionCtlLock {
  const next = structuredClone(lock);
  const current = next.resources[manifest.key] ?? { dataSources: {} };
  if (manifest.id) current.databaseId = manifest.id;
  for (const dataSource of manifest.dataSources) if (dataSource.id) current.dataSources[dataSource.key] = dataSource.id;
  next.resources[manifest.key] = current;
  return lockSchema.parse(next);
}
export function parseDotEnv(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}
export function resolveToken(cwd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const environment = env.NOTIONCTL_ENV?.trim();
  const envKey = environment ? `NOTION_TOKEN_${environment.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}` : "NOTION_TOKEN";
  if (env[envKey]) return env[envKey];
  if (!environment && env.NOTION_TOKEN) return env.NOTION_TOKEN;
  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) return undefined;
  const parsed = parseDotEnv(readFileSync(envPath, "utf8"));
  return parsed[envKey] ?? (!environment ? parsed.NOTION_TOKEN : undefined);
}
