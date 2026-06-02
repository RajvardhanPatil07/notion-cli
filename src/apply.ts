import { CliError } from "./errors.js";
import { hasBlockedOperations, type DiffPlan, type DiffOperation } from "./diff.js";
import type { NotionProvider } from "./notion.js";
import type {
  DatabaseManifest,
  DataSourceManifest,
  NotionCtlLock
} from "./schemas.js";

export interface ApplyResult {
  lock: NotionCtlLock;
}

export async function applyPlan(
  provider: NotionProvider,
  desired: DatabaseManifest,
  plan: DiffPlan,
  lock: NotionCtlLock
): Promise<ApplyResult> {
  if (hasBlockedOperations(plan)) {
    throw new CliError("Apply blocked by unsafe operations. Review the plan or pass an explicit allow flag.");
  }

  let nextLock = structuredClone(lock);
  let databaseId = desired.id ?? lock.resources[desired.key]?.databaseId;

  for (const operation of plan.operations) {
    if (operation.type === "create_database") {
      const response = await provider.createDatabase(operation.payload ?? {});
      databaseId = stringValue(response.id);

      if (!databaseId) {
        throw new CliError("Notion did not return an id for the created database.");
      }

      nextLock = setDatabaseLock(nextLock, desired.key, databaseId);
      nextLock = await refreshCreatedInitialDataSource(provider, desired, nextLock, databaseId);
      continue;
    }

    if (operation.type === "update_database") {
      const id = operation.databaseId ?? databaseId;
      requireId(id, "database");
      await provider.updateDatabase(id, operation.payload ?? {});
      continue;
    }

    if (operation.type === "create_data_source") {
      const parentDatabaseId = operation.databaseId ?? databaseId;
      requireId(parentDatabaseId, "database");
      const dataSource = findDesiredDataSource(desired, operation);
      const response = await provider.createDataSource({
        ...(operation.payload ?? {}),
        parent: {
          database_id: parentDatabaseId
        }
      });
      const dataSourceId = stringValue(response.id);

      if (!dataSourceId) {
        throw new CliError("Notion did not return an id for the created data source.");
      }

      nextLock = setDataSourceLock(nextLock, desired.key, dataSource.key, dataSourceId);
      continue;
    }

    if (
      operation.type === "update_data_source" ||
      operation.type === "add_property" ||
      operation.type === "rename_property" ||
      operation.type === "update_property" ||
      operation.type === "delete_property"
    ) {
      const id =
        operation.dataSourceId ??
        lock.resources[desired.key]?.dataSources[operation.dataSourceKey ?? ""];
      requireId(id, "data source");
      await provider.updateDataSource(id, operation.payload ?? {});
    }
  }

  return { lock: nextLock };
}

function findDesiredDataSource(
  manifest: DatabaseManifest,
  operation: DiffOperation
): DataSourceManifest {
  const dataSource = manifest.dataSources.find(
    (candidate) => candidate.key === operation.dataSourceKey
  );

  if (!dataSource) {
    throw new CliError(`Could not find desired data source "${operation.dataSourceKey}".`);
  }

  return dataSource;
}

async function refreshCreatedInitialDataSource(
  provider: NotionProvider,
  manifest: DatabaseManifest,
  lock: NotionCtlLock,
  databaseId: string
): Promise<NotionCtlLock> {
  const [firstDataSource] = manifest.dataSources;
  if (!firstDataSource) {
    return lock;
  }

  const createdDatabase = await provider.retrieveDatabase(databaseId);
  const refs = Array.isArray(createdDatabase.data_sources)
    ? (createdDatabase.data_sources as Array<Record<string, unknown>>)
    : [];
  const [firstRef] = refs;

  if (typeof firstRef?.id !== "string") {
    return lock;
  }

  return setDataSourceLock(lock, manifest.key, firstDataSource.key, firstRef.id);
}

function setDatabaseLock(
  lock: NotionCtlLock,
  resourceKey: string,
  databaseId: string
): NotionCtlLock {
  const next = structuredClone(lock);
  const resource = next.resources[resourceKey] ?? { dataSources: {} };
  resource.databaseId = databaseId;
  next.resources[resourceKey] = resource;
  return next;
}

function setDataSourceLock(
  lock: NotionCtlLock,
  resourceKey: string,
  dataSourceKey: string,
  dataSourceId: string
): NotionCtlLock {
  const next = structuredClone(lock);
  const resource = next.resources[resourceKey] ?? { dataSources: {} };
  resource.dataSources[dataSourceKey] = dataSourceId;
  next.resources[resourceKey] = resource;
  return next;
}

function requireId(value: string | undefined, kind: string): asserts value is string {
  if (!value) {
    throw new CliError(`Cannot apply operation without a ${kind} id.`);
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
