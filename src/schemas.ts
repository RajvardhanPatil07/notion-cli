import { z } from "zod";

export const resourceKeySchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, {
    message: "Use letters, numbers, underscores, or dashes, starting with a letter or number"
  });

export const parentSchema = z.union([
  z.object({
    type: z.literal("page_id"),
    page_id: z.string().min(1)
  }),
  z.object({
    type: z.literal("workspace"),
    workspace: z.literal(true)
  }),
  z.object({
    type: z.literal("database_id"),
    database_id: z.string().min(1)
  })
]);

export const configResourceSchema = z.object({
  key: resourceKeySchema,
  databaseId: z.string().min(1).optional(),
  manifest: z.string().min(1).optional(),
  parent: parentSchema.optional()
});

export const configSchema = z.object({
  version: z.literal(1).default(1),
  outputDir: z.string().min(1).default("notion"),
  defaults: z
    .object({
      notionVersion: z.string().min(1).default("2026-03-11")
    })
    .default({ notionVersion: "2026-03-11" }),
  resources: z.array(configResourceSchema).default([])
});

export const templateManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  isDefault: z.boolean().default(false)
});

export const propertyManifestSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().min(1)
  })
  .catchall(z.unknown());

export const dataSourceManifestSchema = z.object({
  id: z.string().min(1).optional(),
  key: resourceKeySchema,
  title: z.string(),
  properties: z.record(z.string().min(1), propertyManifestSchema).default({}),
  templates: z.array(templateManifestSchema).default([])
});

export const databaseManifestSchema = z.object({
  version: z.literal(1).default(1),
  kind: z.literal("database").default("database"),
  key: resourceKeySchema,
  id: z.string().min(1).optional(),
  title: z.string(),
  description: z.string().default(""),
  parent: parentSchema.optional(),
  isInline: z.boolean().default(false),
  dataSources: z.array(dataSourceManifestSchema).default([])
});

export const lockSchema = z.object({
  version: z.literal(1).default(1),
  resources: z
    .record(
      resourceKeySchema,
      z.object({
        databaseId: z.string().min(1).optional(),
        dataSources: z.record(resourceKeySchema, z.string().min(1)).default({})
      })
    )
    .default({})
});

export type ParentRef = z.infer<typeof parentSchema>;
export type NotionCtlConfig = z.infer<typeof configSchema>;
export type ConfigResource = z.infer<typeof configResourceSchema>;
export type DatabaseManifest = z.infer<typeof databaseManifestSchema>;
export type DataSourceManifest = z.infer<typeof dataSourceManifestSchema>;
export type PropertyManifest = z.infer<typeof propertyManifestSchema>;
export type TemplateManifest = z.infer<typeof templateManifestSchema>;
export type NotionCtlLock = z.infer<typeof lockSchema>;
