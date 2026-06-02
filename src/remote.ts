import { isNotFoundError } from "./errors.js";
import { normalizeDatabase, type RemoteDataSourceBundle } from "./normalize.js";
import type { NotionProvider } from "./notion.js";
import type { DatabaseManifest } from "./schemas.js";

export async function fetchRemoteManifest(
  provider: NotionProvider,
  key: string,
  databaseId: string
): Promise<DatabaseManifest | undefined> {
  let database: Record<string, unknown>;

  try {
    database = await provider.retrieveDatabase(databaseId);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }

  const bundles: RemoteDataSourceBundle[] = [];
  const dataSourceRefs = Array.isArray(database.data_sources)
    ? (database.data_sources as Array<Record<string, unknown>>)
    : [];

  for (const ref of dataSourceRefs) {
    if (typeof ref.id !== "string") {
      continue;
    }

    const dataSource = await provider.retrieveDataSource(ref.id);
    const templates = await provider.listDataSourceTemplates(ref.id);
    bundles.push({ dataSource, templates });
  }

  return normalizeDatabase(key, database, bundles);
}
