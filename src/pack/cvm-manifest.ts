import { z } from 'zod';

export const UserConfigFieldSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'directory', 'file']),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.any().optional(),
  multiple: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export type UserConfigField = z.infer<typeof UserConfigFieldSchema>;

export const CVMSigSchema = z.object({
  pubkey: z.string(),
  id: z.string(),
  signature: z.string(),
  created_at: z.number(),
});

export type CVMSig = z.infer<typeof CVMSigSchema>;

export const CVMMetaSchema = z.object({
  content_hash: z.string().optional(),
});

export type CVMMeta = z.infer<typeof CVMMetaSchema>;

export const CvmbManifestSchema = z.object({
  manifest_version: z.string(),
  name: z.string(),
  display_name: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be a valid semver version (e.g. 1.0.0)'),
  description: z.string(),
  author: z.object({
    name: z.string(),
    email: z.string().optional(),
    url: z.string().optional(),
  }),
  server: z.object({
    type: z.enum(['node', 'python', 'uv', 'binary', 'docker']),
    entry_point: z.string().optional(),
    image: z.string().optional(),
    compose_file: z.string().optional(),
    transport: z.enum(['stdio', 'cvm']).default('stdio'),
    mcp_config: z.object({
      command: z.string(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
    }),
  }),
  user_config: z.record(z.string(), UserConfigFieldSchema).optional(),
  _meta: z
    .object({
      'com.contextvm': CVMMetaSchema.optional(),
    })
    .optional(),
  _sig: CVMSigSchema.optional(),
});

export type CvmbManifest = z.infer<typeof CvmbManifestSchema>;

export const CvmbManifestSchemaStrict = CvmbManifestSchema.strict();
export const CvmbManifestSchemaPassthrough = CvmbManifestSchema.passthrough();

export function validateManifest(data: unknown, strict = false): CvmbManifest {
  if (strict) {
    return CvmbManifestSchemaStrict.parse(data);
  }
  return CvmbManifestSchemaPassthrough.parse(data);
}
