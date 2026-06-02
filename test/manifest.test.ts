import { describe, expect, it } from "vitest";
import { stringifyManifest } from "../src/manifest.js";
import type { DatabaseManifest } from "../src/schemas.js";

describe("manifest serialization", () => {
  it("writes stable YAML with sorted properties", () => {
    const manifest: DatabaseManifest = {
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
            Status: {
              id: "p2",
              type: "select",
              select: {
                options: []
              }
            },
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

    expect(stringifyManifest(manifest)).toMatchInlineSnapshot(`
      "version: 1
      kind: database
      key: tasks
      id: db1
      title: Tasks
      description: ""
      parent:
        type: page_id
        page_id: page1
      isInline: false
      dataSources:
        - id: ds1
          key: tasks
          title: Tasks
          properties:
            Name:
              id: title
              title: {}
              type: title
            Status:
              id: p2
              select:
                options: []
              type: select
          templates: []
      "
    `);
  });
});
