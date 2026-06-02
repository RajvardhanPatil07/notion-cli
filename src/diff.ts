import { propertyUpdatePayload, richText } from "./notion.js";
import type {
  DatabaseManifest,
  DataSourceManifest,
  PropertyManifest
} from "./schemas.js";
import { deepEqual } from "./stable.js";

export type OperationType =
  | "create_database"
  | "update_database"
  | "create_data_source"
  | "update_data_source"
  | "add_property"
  | "rename_property"
  | "update_property"
  | "delete_property"
  | "delete_property_blocked"
  | "type_change_blocked";

export interface PlanOptions {
  allowDeleteProperties?: boolean;
  allowTypeChange?: boolean;
}

export interface DiffOperation {
  type: OperationType;
  resourceKey: string;
  message: string;
  databaseId?: string;
  dataSourceId?: string;
  dataSourceKey?: string;
  propertyName?: string;
  propertyId?: string;
  blocked?: boolean;
  payload?: Record<string, unknown>;
}

export interface DiffPlan {
  operations: DiffOperation[];
}

export function hasChanges(plan: DiffPlan): boolean {
  return plan.operations.length > 0;
}

export function hasBlockedOperations(plan: DiffPlan): boolean {
  return plan.operations.some((operation) => operation.blocked);
}

export function planDiff(
  desired: DatabaseManifest,
  current: DatabaseManifest | undefined,
  options: PlanOptions = {}
): DiffPlan {
  const operations: DiffOperation[] = [];

  if (!current) {
    operations.push({
      type: "create_database",
      resourceKey: desired.key,
      message: `Create database ${desired.key}`,
      blocked: !desired.parent,
      payload: createDatabasePayload(desired)
    });

    for (const dataSource of desired.dataSources.slice(1)) {
      operations.push({
        type: "create_data_source",
        resourceKey: desired.key,
        dataSourceKey: dataSource.key,
        message: `Create data source ${desired.key}/${dataSource.key}`,
        payload: createDataSourcePayload(undefined, dataSource)
      });
    }

    return { operations };
  }

  const databasePatch = databaseUpdatePayload(desired, current);
  if (Object.keys(databasePatch).length > 0) {
    operations.push({
      type: "update_database",
      resourceKey: desired.key,
      databaseId: current.id,
      message: `Update database ${desired.key}`,
      payload: databasePatch
    });
  }

  for (const desiredDataSource of desired.dataSources) {
    const currentDataSource = findDataSource(current.dataSources, desiredDataSource);

    if (!currentDataSource) {
      operations.push({
        type: "create_data_source",
        resourceKey: desired.key,
        databaseId: current.id,
        dataSourceKey: desiredDataSource.key,
        message: `Create data source ${desired.key}/${desiredDataSource.key}`,
        payload: createDataSourcePayload(current.id, desiredDataSource)
      });
      continue;
    }

    operations.push(
      ...planDataSourceDiff(desired.key, desiredDataSource, currentDataSource, options)
    );
  }

  return { operations };
}

export function createDatabasePayload(
  manifest: DatabaseManifest
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    parent: manifest.parent,
    title: richText(manifest.title),
    description: richText(manifest.description),
    is_inline: manifest.isInline
  };

  const [firstDataSource] = manifest.dataSources;
  if (firstDataSource) {
    payload.initial_data_source = {
      title: richText(firstDataSource.title),
      properties: createPropertiesPayload(firstDataSource.properties)
    };
  }

  return dropUndefined(payload);
}

export function createDataSourcePayload(
  databaseId: string | undefined,
  dataSource: DataSourceManifest
): Record<string, unknown> {
  return dropUndefined({
    parent: databaseId ? { database_id: databaseId } : undefined,
    title: richText(dataSource.title),
    properties: createPropertiesPayload(dataSource.properties)
  });
}

function planDataSourceDiff(
  resourceKey: string,
  desired: DataSourceManifest,
  current: DataSourceManifest,
  options: PlanOptions
): DiffOperation[] {
  const operations: DiffOperation[] = [];

  if (desired.title !== current.title) {
    operations.push({
      type: "update_data_source",
      resourceKey,
      dataSourceId: current.id,
      dataSourceKey: desired.key,
      message: `Update data source ${resourceKey}/${desired.key}`,
      payload: {
        title: richText(desired.title)
      }
    });
  }

  const matchedCurrentPropertyKeys = new Set<string>();
  const currentById = new Map<string, [string, PropertyManifest]>();

  for (const [name, property] of Object.entries(current.properties)) {
    if (property.id) {
      currentById.set(property.id, [name, property]);
    }
  }

  for (const [desiredName, desiredProperty] of Object.entries(desired.properties)) {
    const match = desiredProperty.id
      ? currentById.get(desiredProperty.id)
      : current.properties[desiredName]
        ? ([desiredName, current.properties[desiredName]] as [string, PropertyManifest])
        : undefined;

    if (!match) {
      operations.push({
        type: "add_property",
        resourceKey,
        dataSourceId: current.id,
        dataSourceKey: desired.key,
        propertyName: desiredName,
        message: `Add property ${resourceKey}/${desired.key}.${desiredName}`,
        payload: {
          properties: {
            [desiredName]: propertyUpdatePayload(desiredProperty)
          }
        }
      });
      continue;
    }

    const [currentName, currentProperty] = match;
    matchedCurrentPropertyKeys.add(currentName);

    if (currentName !== desiredName) {
      operations.push({
        type: "rename_property",
        resourceKey,
        dataSourceId: current.id,
        dataSourceKey: desired.key,
        propertyName: desiredName,
        propertyId: currentProperty.id,
        message: `Rename property ${resourceKey}/${desired.key}.${currentName} to ${desiredName}`,
        payload: {
          properties: {
            [propertyAddress(currentName, currentProperty)]: {
              name: desiredName
            }
          }
        }
      });
    }

    if (currentProperty.type !== desiredProperty.type && !options.allowTypeChange) {
      operations.push({
        type: "type_change_blocked",
        resourceKey,
        dataSourceId: current.id,
        dataSourceKey: desired.key,
        propertyName: desiredName,
        propertyId: currentProperty.id,
        blocked: true,
        message: `Blocked type change ${resourceKey}/${desired.key}.${desiredName}: ${currentProperty.type} -> ${desiredProperty.type}`
      });
      continue;
    }

    if (!samePropertyDefinition(currentProperty, desiredProperty)) {
      operations.push({
        type: "update_property",
        resourceKey,
        dataSourceId: current.id,
        dataSourceKey: desired.key,
        propertyName: desiredName,
        propertyId: currentProperty.id,
        message:
          currentProperty.type === desiredProperty.type
            ? `Update property ${resourceKey}/${desired.key}.${desiredName}`
            : `Change property type ${resourceKey}/${desired.key}.${desiredName}: ${currentProperty.type} -> ${desiredProperty.type}`,
        payload: {
          properties: {
            [propertyAddress(currentName, currentProperty)]:
              propertyUpdatePayload(desiredProperty)
          }
        }
      });
    }
  }

  for (const [currentName, currentProperty] of Object.entries(current.properties)) {
    if (matchedCurrentPropertyKeys.has(currentName)) {
      continue;
    }

    if (options.allowDeleteProperties) {
      operations.push({
        type: "delete_property",
        resourceKey,
        dataSourceId: current.id,
        dataSourceKey: desired.key,
        propertyName: currentName,
        propertyId: currentProperty.id,
        message: `Delete property ${resourceKey}/${desired.key}.${currentName}`,
        payload: {
          properties: {
            [propertyAddress(currentName, currentProperty)]: null
          }
        }
      });
    } else {
      operations.push({
        type: "delete_property_blocked",
        resourceKey,
        dataSourceId: current.id,
        dataSourceKey: desired.key,
        propertyName: currentName,
        propertyId: currentProperty.id,
        blocked: true,
        message: `Blocked property delete ${resourceKey}/${desired.key}.${currentName}`
      });
    }
  }

  return operations;
}

function databaseUpdatePayload(
  desired: DatabaseManifest,
  current: DatabaseManifest
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (desired.title !== current.title) {
    payload.title = richText(desired.title);
  }

  if (desired.description !== current.description) {
    payload.description = richText(desired.description);
  }

  if (desired.isInline !== current.isInline) {
    payload.is_inline = desired.isInline;
  }

  if (desired.parent && !deepEqual(desired.parent, current.parent)) {
    payload.parent = desired.parent;
  }

  return payload;
}

function createPropertiesPayload(
  properties: Record<string, PropertyManifest>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [name, property] of Object.entries(properties)) {
    output[name] = propertyUpdatePayload(property);
  }

  return output;
}

function findDataSource(
  currentDataSources: DataSourceManifest[],
  desired: DataSourceManifest
): DataSourceManifest | undefined {
  if (desired.id) {
    const byId = currentDataSources.find((dataSource) => dataSource.id === desired.id);
    if (byId) {
      return byId;
    }
  }

  return currentDataSources.find(
    (dataSource) => dataSource.key === desired.key || dataSource.title === desired.title
  );
}

function samePropertyDefinition(
  current: PropertyManifest,
  desired: PropertyManifest
): boolean {
  return deepEqual(
    propertyUpdatePayload(current),
    propertyUpdatePayload(desired)
  );
}

function propertyAddress(name: string, property: PropertyManifest): string {
  return property.id ?? name;
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      output[key] = child;
    }
  }

  return output as T;
}
