import { describe, expect, it } from "vitest";
import { planDiff } from "../src/diff.js";
import type { DatabaseManifest } from "../src/schemas.js";

function baseManifest(): DatabaseManifest {
  return {
    version: 1,
    kind: "database",
    key: "tasks",
    id: "db1",
    title: "Tasks",
    description: "",
    parent: {
      type: "page_id",
      page_id: "page1"
    },
    isInline: false,
    dataSources: [
      {
        id: "ds1",
        key: "tasks",
        title: "Tasks",
        properties: {
          Name: {
            id: "title",
            type: "title",
            title: {}
          }
        },
        templates: []
      }
    ]
  };
}

describe("diff planner", () => {
  it("uses property ids to plan renames", () => {
    const current = baseManifest();
    const desired = baseManifest();
    desired.dataSources[0].properties = {
      Renamed: {
        id: "title",
        type: "title",
        title: {}
      }
    };

    expect(planDiff(desired, current).operations.map((operation) => operation.type)).toEqual([
      "rename_property"
    ]);
  });

  it("blocks property deletes by default", () => {
    const current = baseManifest();
    const desired = baseManifest();
    desired.dataSources[0].properties = {};

    const plan = planDiff(desired, current);

    expect(plan.operations[0]).toMatchObject({
      type: "delete_property_blocked",
      blocked: true
    });
  });

  it("blocks property type changes by default", () => {
    const current = baseManifest();
    const desired = baseManifest();
    desired.dataSources[0].properties.Name = {
      id: "title",
      type: "rich_text",
      rich_text: {}
    };

    const plan = planDiff(desired, current);

    expect(plan.operations[0]).toMatchObject({
      type: "type_change_blocked",
      blocked: true
    });
  });

  it("plans database creation as blocked when no parent is declared", () => {
    const desired = baseManifest();
    desired.parent = undefined;

    const plan = planDiff(desired, undefined);

    expect(plan.operations[0]).toMatchObject({
      type: "create_database",
      blocked: true
    });
  });
});
