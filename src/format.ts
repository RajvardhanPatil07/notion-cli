import type { DiffPlan, DiffOperation } from "./diff.js";

const SYMBOLS: Record<string, string> = {
  create_database: "+",
  update_database: "~",
  create_data_source: "+",
  update_data_source: "~",
  add_property: "+",
  rename_property: "~",
  update_property: "~",
  delete_property: "-",
  delete_property_blocked: "!",
  type_change_blocked: "!"
};

export function formatPlan(plan: DiffPlan): string {
  if (plan.operations.length === 0) {
    return "No changes.\n";
  }

  const lines = ["Plan:"];

  for (const operation of plan.operations) {
    lines.push(`  ${SYMBOLS[operation.type] ?? "?"} ${operation.message}`);
  }

  return `${lines.join("\n")}\n`;
}

export function planToJson(plan: DiffPlan): string {
  return `${JSON.stringify(
    {
      hasChanges: plan.operations.length > 0,
      blocked: plan.operations.some((operation) => operation.blocked),
      operations: plan.operations.map(serializeOperation)
    },
    null,
    2
  )}\n`;
}

function serializeOperation(operation: DiffOperation): Record<string, unknown> {
  return {
    type: operation.type,
    resourceKey: operation.resourceKey,
    databaseId: operation.databaseId,
    dataSourceId: operation.dataSourceId,
    dataSourceKey: operation.dataSourceKey,
    propertyName: operation.propertyName,
    propertyId: operation.propertyId,
    blocked: operation.blocked ?? false,
    message: operation.message
  };
}
