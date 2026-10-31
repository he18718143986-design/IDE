/**
 * TASK-L.11：`docs/system/modules.yaml` 的 zod Schema 与类型（L.12 复用）。
 */

import { z } from "zod";

export const moduleEntrySchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "module id must be kebab-case"),
  name: z.string().min(1),
  purpose: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  depends_on: z.array(z.string().min(1)).default([]),
  interfaces: z.array(z.string().min(1)).default([]),
  introduced_by: z.string().min(1),
  updated_by: z.array(z.string().min(1)).default([]),
});

export type ModuleEntry = z.infer<typeof moduleEntrySchema>;

export const modulesYamlSchema = z.object({
  schema_version: z.literal("1.0.0"),
  modules: z.array(moduleEntrySchema),
});

export type ModulesYaml = z.infer<typeof modulesYamlSchema>;

export function parseModulesYaml(data: unknown): ModulesYaml {
  return modulesYamlSchema.parse(data);
}

export function safeParseModulesYaml(data: unknown) {
  return modulesYamlSchema.safeParse(data);
}
