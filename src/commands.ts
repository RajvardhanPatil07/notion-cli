import { Command, CommanderError } from "commander";
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
import type {
  ConfigResource,
  DatabaseManifest,
  NotionCtlConfig,
  NotionCtlLock
} from "./schemas.js";
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
    .description("Conservative GitOps for Notion databases and data sources")
    .version("0.1.0")
    .configureOutput({
      writeOut: (text) => writeOut(context, text),
      writeErr: (text) => writeErr(context, text)
    });

  program
    .command("init")
    .description("Create or update notionctl.yaml with a managed database")
    .requiredOption("--database <id>", "Notion database id to manage")
    .requiredOption("--name <key>", "Local logical resource key")
    .action(async (options: { database: string; name: string }) => {
      const cwd = getCwd(context);
      const config = loadConfig(cwd, false);
      const nextConfig = upsertResource(config, {
        key: options.name,
        databaseId: options.database,
        manifest: `databases/${options.name}.yaml`
      });

      ensureOutputDirs(cwd, nextConfig);
      saveConfig(cwd, nextConfig);
      writeOut(context, `Initialized ${options.name} in notionctl.yaml.\n`);
    });

  program
    .command("pull")
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
        if (!databaseId) {
          throw new CliError(`Resource "${resource.key}" does not have a database id.`);
        }

        const remote = await fetchRemoteManifest(provider, resource.key, databaseId);
        if (!remote) {
          throw new CliError(`Database "${databaseId}" was not found for "${resource.key}".`);
        }

        writeManifest(cwd, config, resource, remote);
        nextLock = updateLockFromManifest(nextLock, remote);
        writeOut(context, `Pulled ${resource.key}.\n`);
      }

      saveLock(cwd, config, nextLock);
    });

  program
    .command("diff")
    .description("Compare local manifests with live Notion resources")
    .option("--resource <key>", "Only diff one resource")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { resource?: string; json?: boolean }) => {
      const { planned, changed } = await createPlans(context, {
        resourceKey: options.resource
      });

      writePlans(context, planned, Boolean(options.json));

      if (changed) {
        setExitCode(context, 2);
      }
    });

  program
    .command("apply")
    .description("Apply local manifests to Notion after printing a plan")
    .option("--resource <key>", "Only apply one resource")
    .option("--yes", "Confirm mutations")
    .option("--allow-delete-properties", "Allow deleting Notion data source properties")
    .option("--allow-type-change", "Allow Notion property type changes")
    .action(
      async (options: {
        resource?: string;
        yes?: boolean;
        allowDeleteProperties?: boolean;
        allowTypeChange?: boolean;
      }) => {
        const { cwd, config, lock, provider, planned, changed, blocked } =
          await createPlans(context, {
            resourceKey: options.resource,
            allowDeleteProperties: options.allowDeleteProperties,
            allowTypeChange: options.allowTypeChange
          });

        writePlans(context, planned, false);

        if (!changed) {
          return;
        }

        if (!options.yes) {
          throw new CliError("Apply requires --yes when the plan contains changes.");
        }

        if (blocked) {
          throw new CliError("Apply blocked by unsafe operations in the plan.");
        }

        let nextLock = lock;
        for (const item of planned) {
          const result = await applyPlan(provider, item.desired, item.plan, nextLock);
          nextLock = result.lock;
          writeOut(context, `Applied ${item.resource.key}.\n`);
        }

        saveLock(cwd, config, nextLock);
      }
    );

  program
    .command("validate")
    .description("Validate notionctl.yaml and all configured manifests")
    .action(async () => {
      const cwd = getCwd(context);
      const config = loadConfig(cwd);

      for (const resource of selectResources(config)) {
        const { warnings } = readManifestWithWarnings(cwd, config, resource);
        for (const warning of warnings) {
          writeErr(context, `${warning}\n`);
        }
      }

      writeOut(context, `Validated ${config.resources.length} resource(s).\n`);
    });

  return program;
}

export async function runCli(argv: string[], context: CliContext = {}): Promise<void> {
  const program = createProgram(context);

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      setExitCode(context, 0);
      return;
    }

    const exitCode =
      error instanceof CliError
        ? error.exitCode
        : error instanceof CommanderError
          ? error.exitCode
          : 1;

    writeErr(context, `${getErrorMessage(error)}\n`);
    setExitCode(context, exitCode);
  }
}

async function createPlans(
  context: CliContext,
  options: {
    resourceKey?: string;
    allowDeleteProperties?: boolean;
    allowTypeChange?: boolean;
  }
): Promise<{
  cwd: string;
  config: NotionCtlConfig;
  lock: NotionCtlLock;
  provider: NotionProvider;
  planned: PlannedResource[];
  changed: boolean;
  blocked: boolean;
}> {
  const cwd = getCwd(context);
  const config = loadConfig(cwd);
  const lock = loadLock(cwd, config);
  const provider = createProvider(context, cwd, config);
  const planned: PlannedResource[] = [];

  for (const resource of selectResources(config, options.resourceKey)) {
    const { manifest: desired, warnings } = readManifestWithWarnings(cwd, config, resource);
    for (const warning of warnings) {
      writeErr(context, `${warning}\n`);
    }
    const databaseId = resolveDatabaseId(resource, desired.id, lock);
    const current = databaseId
      ? await fetchRemoteManifest(provider, resource.key, databaseId)
      : undefined;
    const plan = planDiff(desired, current, {
      allowDeleteProperties: options.allowDeleteProperties,
      allowTypeChange: options.allowTypeChange
    });

    planned.push({ resource, desired, current, plan });
  }

  return {
    cwd,
    config,
    lock,
    provider,
    planned,
    changed: planned.some((item) => hasChanges(item.plan)),
    blocked: planned.some((item) => hasBlockedOperations(item.plan))
  };
}

function writePlans(context: CliContext, planned: PlannedResource[], json: boolean): void {
  if (json) {
    writeOut(
      context,
      `${JSON.stringify(
        {
          resources: planned.map((item) => ({
            key: item.resource.key,
            plan: JSON.parse(planToJson(item.plan))
          }))
        },
        null,
        2
      )}\n`
    );
    return;
  }

  for (const item of planned) {
    writeOut(context, `${item.resource.key}:\n${formatPlan(item.plan)}`);
  }
}

function createProvider(
  context: CliContext,
  cwd: string,
  config: NotionCtlConfig
): NotionProvider {
  const token = resolveToken(cwd, context.env);
  if (!token) {
    throw new CliError("Missing NOTION_TOKEN. Set it in the environment or .env.");
  }

  return context.providerFactory
    ? context.providerFactory(token, config.defaults.notionVersion)
    : new HttpNotionProvider(token, config.defaults.notionVersion);
}

function getCwd(context: CliContext): string {
  return context.cwd ?? process.cwd();
}

function writeOut(context: CliContext, text: string): void {
  (context.stdout ?? process.stdout.write.bind(process.stdout))(text);
}

function writeErr(context: CliContext, text: string): void {
  (context.stderr ?? process.stderr.write.bind(process.stderr))(text);
}

function setExitCode(context: CliContext, code: number): void {
  if (context.setExitCode) {
    context.setExitCode(code);
    return;
  }

  process.exitCode = code;
}
