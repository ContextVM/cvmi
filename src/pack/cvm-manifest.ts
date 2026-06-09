import { z } from 'zod';
import { DEFAULT_RELAYS } from '../config/index.ts';

export const CVMMetaSchema = z.object({
  public: z.boolean().default(false),
  default_relays: z.array(z.string()).default(DEFAULT_RELAYS),
  encryption: z.enum(['nip44', 'optional', 'disabled']).default('optional'),
  announce: z.boolean().default(true),
  pricing: z.any().nullable().default(null),
});

export type CVMMeta = z.infer<typeof CVMMetaSchema>;

// The full manifest including MCPB and CVM extension
export const McpbManifestSchema = z
  .object({
    manifest_version: z.string(),
    name: z.string(),
    display_name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    author: z.object({
      name: z.string(),
      email: z.string().optional(),
      url: z.string().optional(),
    }),
    server: z.object({
      type: z.enum(['node', 'python', 'binary']),
      entry_point: z.string(),
      mcp_config: z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
      }),
    }),
    user_config: z.record(z.string(), z.any()).optional(),
    _meta: z
      .object({
        'com.contextvm': CVMMetaSchema.optional(),
      })
      .optional(),
  })
  .passthrough();

export type McpbManifest = z.infer<typeof McpbManifestSchema>;

export function validateManifest(data: unknown): McpbManifest {
  return McpbManifestSchema.parse(data);
}

export const DEFAULT_CVM_META: CVMMeta = {
  public: false,
  default_relays: DEFAULT_RELAYS,
  encryption: 'optional',
  announce: true,
  pricing: null,
};
