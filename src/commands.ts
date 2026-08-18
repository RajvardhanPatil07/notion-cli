import { Command, CommanderError } from "commander";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  defaultConfig,
  ensureOutputDirs,
  loadConfig,
  loadLock,
  resolveDatabaseId,
  resolveToken,
  saveConfig,
  saveLock,
  selectResources,
  updateLockFromManifest,
  upsertResource
} from "./config.js";
import { CliError, getErrorMessage } from "./errors.js";
import { applyPlan } from "./apply.js";
import { planDiff, hasChanges, hasBlockedOperations, type DiffPlan } from "./diff.js";
import { formatPlan, planToJson } from "./format.js";
import { HttpNotionProvider, type NotionProvider } from "./notion.js";
import { fetchRemoteManifest } from "./remote.js";
import type { ConfigResource, DatabaseManifest, NotionCtlConfig, NotionCtlLock } from "./schemas.js";
import { readManifestWithWarnings, writeManifest } from "./manifest.js";

export interface CliContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  setExitCode?: (code: number) => void;
  providerFactory?: (token: string, notionVersion: string) => NotionProvider;
}

interface PlannedResource {
  resource: ConfigResource;
  desired: DatabaseManifest;
  current: DatabaseManifest | undefined;
  plan: DiffPlan;
}

export function createProgram(context: CliContext = {}): Command {
  const program = new Command();
  program
    .name("notionctl")
    .description("Safe GitOps and infrastructure-as-code for Notion databases and data sources")
    .version("0.2.0")
    .configureOutput({ writeOut: (text) => writeOut(context, text), writeErr: (text) => writeErr(context, text) });

  program.command("init")
    .description("Create or update notionctl.yaml with a managed database")
    .requiredOption("--database <id>", "Notion database id to manage")
    .requiredOption("--name <key>", "Local logical resource key")
    .action(async (options: { database: string; name: string }) => {
      const cwd = getCwd(context);
      const config = loadConfig(cwd, false);
      const nextConfig = upsertResource(config, { key: options.name, databaseId: options.database, manifest: `databases/${options.name}.yaml` });
      ensureOutputDirs(cwd, nextConfig);
      saveConfig(cwd, nextConfig);
      writeOut(context, `Initialized ${options.name} in notionctl.yaml.\n`);
    });

  program.command("pull")
    .description("Pull configured Notion resources into YAML manifests")
    .option("--resource <key>", "Only pull one resource")
    .action(async (options: { resource?: string }) => {
      const cwd = getCwd(context);
      const config = loadConfig(cwd);
      const lock = loadLock(cwd, config);
      const provider = createProvider(context, cwd, config);
      let nextLock = lock;
      for (const resource of selectResources(config, options.resource)) {
        const databaseId = resolveDatabaseId(resource, undefined, nextLock);
        if (!databaseId) throw new CliError(`Resource "${resource.key}" does not have a database id.`);
        const remote = await fetchRemoteManifest(provider, resource.key, databaseId);
        if (!remote) throw new CliError(`Database "${databaseId}" was not found for "${resource.key}".`);
        writeManifest(cwd, config, resource, remote);
        nextLock = updateLockFromManifest(nextLock, remote);
        writeOut(context, `Pulled ${resource.key}.\n`);
      }
      saveLock(cwd, config, nextLock);
    });

  const planCommand = program.command("plan")
    .description("Calculate and display the changes required to reconcile Notion")
    .option("--resource <key>", "Only plan one resource")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { resource?: string; json?: boolean }) => {
      const { planned, changed } = await createPlans(context, { resourceKey: options.resource });
      writePlans(context, planned, Boolean(options.json));
      if (changed) setExitCode(context, 2);
    });
  planCommand.alias("diff");

  program.command("drift")
    .description("Detect drift between local manifests and live Notion resources")
    .option("--resource <key>", "Only check one resource")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { resource?: string; json?: boolean }) => {
      const { planned, changed } = await createPlans(context, { resourceKey: options.resource });
      writePlans(context, planned, Boolean(options.json));
      writeOut(context, changed ? "Drift detected.\n" : "No drift detected.\n");
      if (changed) setExitCode(context, 2);
    });

  program.command("status")
    .description("Show managed resources and their current drift status")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const { config, planned } = await createPlans(context, {});
      const rows = planned.map((item) => ({ key: item.resource.key, changed: hasChanges(item.plan), blocked: hasBlockedOperations(item.plan) }));
      if (options.json) {
        writeOut(context, `${JSON.stringify({ resources: rows }, null, 2)}\n`);
      } else {
        writeOut(context, `Environment: ${context.env?.NOTIONCTL_ENV ?? "default"}\nManaged resources: ${config.resources.length}\n`);
        for (const row of rows) writeOut(context, `  ${row.changed ? "DRIFT" : "OK    "} ${row.key}${row.blocked ? " (blocked operations)" : ""}\n`);
      }
      if (rows.some((row) => row.changed)) setExitCode(context, 2);
    });

  program.command("validate")
    .description("Validate notionctl.yaml and all configured manifests")
    .action(async () => {
      const cwd = getCwd(context);
      const config = loadConfig(cwd);
      for (const resource of selectResources(config)) {
        const { warnings } = readManifestWithWarnings(cwd, config, resource);
        for (const warning of warnings) writeErr(context, `${warning}\n`);
      }
      writeOut(context, `Validated ${config.resources.length} resource(s).\n`);
    });

  program.command("doctor")
    .description("Diagnose local configuration and Notion API access")
    .action(async () => {
      const cwd = getCwd(context);
      const config = loadConfig(cwd, false);
      const token = resolveToken(cwd, context.env);
      writeOut(context, `✓ notionctl configuration loaded\n`);
      writeOut(context, `✓ Node.js ${process.versions.node}\n`);
      writeOut(context, token ? "✓ NOTION_TOKEN is configured\n" : "✗ NOTION_TOKEN is missing\n");
      if (!token) {
        setExitCode(context, 1);
        return;
      }
      const provider = createProvider(context, cwd, config);
      try {
        const resources = selectResources(config);
        if (resources.length === 0) {
          writeOut(context, "✓ No remote resources configured yet\n");
        } else {
          for (const resource of resources) {
            const id = resolveDatabaseId(resource, undefined, loadLock(cwd, config));
            if (!id) { writeOut(context, `! ${resource.key}: no database id\n`); continue; }
            const remote = await fetchRemoteManifest(provider, resource.key, id);
            writeOut(context, remote ? `✓ ${resource.key}: API access OK\n` : `✗ ${resource.key}: database not found\n`);
          }
        }
      } catch (error) {
        writeErr(context, `✗ Notion API check failed: ${getErrorMessage(error)}\n`);
        setExitCode(context, 1);
      }
    });

  const migrate = program.command("migrate").description("Manage ordered local schema migration files");
  migrate.command("create")
    .description("Create a new migration file")
    .argument("<name>", "Migration name")
    .action((name: string) => {
      const cwd = getCwd(context);
      const dir = path.join(cwd, "migrations");
      mkdirSync(dir, { recursive: true });
      const existing = readdirSync(dir).filter((file) => /^\\d{3}-.*\\.yaml$/.test(file));
      const next = String(existing.length + 1).padStart(3, "0");
      const safe = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const file = path.join(dir, `${next}-${safe || "migration"}.yaml`);
      writeFileSync(file, `version: 1\nname: ${safe || "migration"}\nchanges: []\n`, "utf8");
      writeOut(context, `Created migrations/${path.basename(file)}.\n`);
    });
  migrate.command("status")
    .description("List local schema migrations")
    .action(() => {
      const dir = path.join(getCwd(context), "migrations");
      if (!existsSync(dir)) { writeOut(context, "No migrations directory.\n"); return; }
      const files = readdirSync(dir).filter((file) => /^\\d{3}-.*\\.yaml$/.test(file)).sort();
      if (!files.length) { writeOut(context, "No migrations.\n"); return; }
      for (const file of files) writeOut(context, `  ${file}\n`);
    });

  program.command("apply")
    .description("Apply local manifests to Notion after printing a fresh plan")
    .option("--resource <key>", "Only apply one resource")
    .option("--yes", "Confirm mutations")
    .option("--plan <id>", "Require the freshly calculated plan to match this SHA-256 id")
    .option("--allow-delete-properties", "Allow deleting Notion data source properties")
    .option("--allow-type-change", "Allow Notion property type changes")
    .action(async (options: { resource?: string; yes?: boolean; plan?: string; allowDeleteProperties?: boolean; allowTypeChange?: boolean }) => {
      const { cwd, config, lock, provider, planned, changed, blocked } = await createPlans(context, {
        resourceKey: options.resource,
        allowDeleteProperties: options.allowDeleteProperties,
        allowTypeChange: options.allowTypeChange
      });
      const planId = calculatePlanId(planned);
      writePlans(context, planned, false);
      writeOut(context, `Plan ID: ${planId}\n`);
      if (options.plan && options.plan !== planId) throw new CliError(`Plan ID mismatch. Expected ${options.plan}, but the current remote state produces ${planId}. Re-run plan.`);
      if (!changed) return;
      if (!options.yes) throw new CliError("Apply requires --yes when the plan contains changes.");
      if (blocked) throw new CliError("Apply blocked by unsafe operations in the plan.");
      let nextLock = lock;
      for (const item of planned) {
        const result = await applyPlan(provider, item.desired, item.plan, nextLock);
        nextLock = result.lock;
        writeOut(context, `Applied ${item.resource.key}.\n`);
      }
      saveLock(cwd, config, nextLock);
    });

  return program;
}

export async function runCli(argv: string[], context: CliContext = {}): Promise<void> {
  const program = createProgram(context);
  try { await program.parseAsync(argv, { from: "user" }); }
  catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) { setExitCode(context, 0); return; }
    const exitCode = error instanceof CliError ? error.exitCode : error instanceof CommanderError ? error.exitCode : 1;
    writeErr(context, `${getErrorMessage(error)}\n`);
    setExitCode(context, exitCode);
  }
}

async function createPlans(context: CliContext, options: { resourceKey?: string; allowDeleteProperties?: boolean; allowTypeChange?: boolean }): Promise<{
  cwd: string; config: NotionCtlConfig; lock: NotionCtlLock; provider: NotionProvider; planned: PlannedResource[]; changed: boolean; blocked: boolean;
}> {
  const cwd = getCwd(context);
  const config = loadConfig(cwd);
  const lock = loadLock(cwd, config);
  const provider = createProvider(context, cwd, config);
  const planned: PlannedResource[] = [];
  for (const resource of selectResources(config, options.resourceKey)) {
    const { manifest: desired, warnings } = readManifestWithWarnings(cwd, config, resource);
    for (const warning of warnings) writeErr(context, `${warning}\n`);
    const databaseId = resolveDatabaseId(resource, desired.id, lock);
    const current = databaseId ? await fetchRemoteManifest(provider, resource.key, databaseId) : undefined;
    const plan = planDiff(desired, current, { allowDeleteProperties: options.allowDeleteProperties, allowTypeChange: options.allowTypeChange });
    planned.push({ resource, desired, current, plan });
  }
  return { cwd, config, lock, provider, planned, changed: planned.some((item) => hasChanges(item.plan)), blocked: planned.some((item) => hasBlockedOperations(item.plan)) };
}

function writePlans(context: CliContext, planned: PlannedResource[], json: boolean): void {
  if (json) {
    writeOut(context, `${JSON.stringify({ planId: calculatePlanId(planned), resources: planned.map((item) => ({ key: item.resource.key, plan: JSON.parse(planToJson(item.plan)) })) }, null, 2)}\n`);
    return;
  }
  for (const item of planned) writeOut(context, `${item.resource.key}:\n${formatPlan(item.plan)}`);
}

function calculatePlanId(planned: PlannedResource[]): string {
  const normalized = planned.map((item) => ({ key: item.resource.key, plan: JSON.parse(planToJson(item.plan)) }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

function createProvider(context: CliContext, cwd: string, config: NotionCtlConfig): NotionProvider {
  const token = resolveToken(cwd, context.env);
  if (!token) throw new CliError("Missing NOTION_TOKEN. Set it in the environment or .env.");
  return context.providerFactory ? context.providerFactory(token, config.defaults.notionVersion) : new HttpNotionProvider(token, config.defaults.notionVersion);
}
function getCwd(context: CliContext): string { return context.cwd ?? process.cwd(); }
function writeOut(context: CliContext, text: string): void { (context.stdout ?? process.stdout.write.bind(process.stdout))(text); }
function writeErr(context: CliContext, text: string): void { (context.stderr ?? process.stderr.write.bind(process.stderr))(text); }
function setExitCode(context: CliContext, code: number): void { if (context.setExitCode) context.setExitCode(code); else process.exitCode = code; }
