import { test, expect } from 'vitest';
import { generateClientCode, resolveSchemaRefs } from './schema';

// Mock tool data with various naming patterns
const mockTools = [
  {
    name: 'add-user',
    description: 'Add a new user',
    inputSchema: {
      type: 'object',
      properties: {
        pubkey: { type: 'string', description: "User's public key" },
        relays: { type: 'array', items: { type: 'string' } },
      },
      required: ['pubkey'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            pubkey: { type: 'string' },
            relays: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  {
    name: 'delete_user_data',
    description: 'Delete user data',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
      },
      required: ['userId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get-user-info',
    description: 'Get user information',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        user: { type: 'object' },
      },
    },
  },
  {
    name: 'simple',
    description: 'A simple tool',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      properties: {
        result: { type: 'string' },
      },
    },
  },
];

const mockToolListResult = {
  tools: mockTools,
};

test('generateClientCode converts hyphenated tool names to PascalCase', async () => {
  const pubkey = 'test-pubkey';
  const serverName = 'TestServer';

  const clientCode = await generateClientCode(pubkey, mockToolListResult, serverName);

  // Check that the generated code contains PascalCase method names
  expect(clientCode).toContain('async AddUser(');
  expect(clientCode).toContain('async DeleteUserData(');
  expect(clientCode).toContain('async GetUserInfo(');
  expect(clientCode).toContain('async Simple(');

  // Check that the original tool names are used in the call method
  expect(clientCode).toContain('return this.call("add-user"');
  expect(clientCode).toContain('return this.call("delete_user_data"');
  expect(clientCode).toContain('return this.call("get-user-info"');
  expect(clientCode).toContain('return this.call("simple"');

  // Check that the server type uses PascalCase
  expect(clientCode).toContain('AddUser:');
  expect(clientCode).toContain('DeleteUserData:');
  expect(clientCode).toContain('GetUserInfo:');
  expect(clientCode).toContain('Simple:');
});

test('generateClientCode creates valid TypeScript syntax', async () => {
  const pubkey = 'test-pubkey';
  const serverName = 'TestServer';

  const clientCode = await generateClientCode(pubkey, mockToolListResult, serverName);

  // Check that the generated code doesn't contain invalid syntax patterns
  // Methods with hyphens would be invalid TypeScript
  expect(clientCode).not.toContain('async add-user(');
  expect(clientCode).not.toContain('async delete_user_data(');
  expect(clientCode).not.toContain('async get-user-info(');

  // Check that the code contains proper TypeScript syntax
  expect(clientCode).toContain('export class TestServerClient');
  expect(clientCode).toContain('implements TestServer');
  expect(clientCode).toContain('async disconnect(): Promise<void>');
});

test('generateClientCode handles tools with no parameters', async () => {
  const noParamTool = {
    name: 'no-params-tool',
    description: 'Tool with no parameters',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      properties: {
        result: { type: 'string' },
      },
    },
  };

  const mockToolList = {
    tools: [noParamTool],
  };

  const clientCode = await generateClientCode('test-pubkey', mockToolList, 'TestServer');

  // Check that the method is generated with PascalCase name
  expect(clientCode).toContain('async NoParamsTool(');
  expect(clientCode).toContain('return this.call("no-params-tool"');
});

test('resolveSchemaRefs handles internal $ref references', async () => {
  // Test schema with $ref pointing to another property
  const testSchema = {
    type: 'object',
    properties: {
      bookmarks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_event: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                kind: { type: 'number' },
                content: { type: 'string' },
              },
              required: ['id', 'kind', 'content'],
            },
            target_event: {
              $ref: '#/properties/bookmarks/items/properties/source_event',
            },
          },
        },
      },
    },
  };

  const resolved = resolveSchemaRefs(testSchema);

  // The $ref should be resolved to the actual schema
  expect(resolved.properties.bookmarks.items.properties.target_event).toEqual({
    type: 'object',
    properties: {
      id: { type: 'string' },
      kind: { type: 'number' },
      content: { type: 'string' },
    },
    required: ['id', 'kind', 'content'],
  });
});

test('generateClientCode handles schemas with $ref references', async () => {
  // Mock tool with $ref in output schema
  const toolWithRef = {
    name: 'search-bookmarks',
    description: 'Search bookmarks',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        bookmarks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source_event: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  kind: { type: 'number' },
                  content: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  sig: { type: 'string' },
                },
                required: ['id', 'kind', 'content', 'tags', 'sig'],
              },
              target_event: {
                $ref: '#/properties/bookmarks/items/properties/source_event',
              },
            },
          },
        },
      },
    },
  };

  const mockToolList = {
    tools: [toolWithRef],
  };

  const clientCode = await generateClientCode('test-pubkey', mockToolList, 'TestServer');

  // The generated code should have resolved the $ref and include the full type definition
  expect(clientCode).toContain('source_event?: {');
  expect(clientCode).toContain('target_event?: {');
  // Both should have the same structure with id, kind, content, tags, sig
  expect(clientCode).toContain('id: string;');
  expect(clientCode).toContain('kind: number;');
  expect(clientCode).toContain('content: string;');
  expect(clientCode).toContain('tags: string[];');
  expect(clientCode).toContain('sig: string;');
});

test('generateClientCode includes proper relay configuration and private key precedence', async () => {
  const pubkey = 'test-pubkey';
  const serverName = 'TestServer';
  const customRelays = ['wss://custom-relay1.org', 'wss://custom-relay2.org'];
  const configPrivateKey = 'config-private-key-123';

  // Test 1: No relays provided (should use defaults)
  const clientCode1 = await generateClientCode(pubkey, mockToolListResult, serverName);

  // Should include default relay configuration
  expect(clientCode1).toContain('DEFAULT_RELAYS = ["wss://relay.contextvm.org"]');

  // Test 2: Custom relays provided
  const clientCode2 = await generateClientCode(
    pubkey,
    mockToolListResult,
    serverName,
    undefined,
    customRelays
  );

  // Should include custom relays
  expect(clientCode2).toContain(
    'DEFAULT_RELAYS = ["wss://custom-relay1.org", "wss://custom-relay2.org"]'
  );

  // Test 3: Private key from config
  const clientCode3 = await generateClientCode(
    pubkey,
    mockToolListResult,
    serverName,
    configPrivateKey
  );

  // Should include config private key in the precedence chain
  expect(clientCode3).toContain('"config-private-key-123"');
});

test('generateClientCode properly infers array types', async () => {
  const toolWithArray = {
    name: 'calculate-trust-scores',
    description: 'Calculate trust scores for pubkeys',
    inputSchema: {
      type: 'object',
      properties: {
        targetPubkeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target pubkeys to calculate trust scores for',
        },
        weights: {
          type: 'array',
          items: { type: 'number' },
          description: 'Weights for each pubkey',
        },
      },
      required: ['targetPubkeys'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        scores: {
          type: 'array',
          items: { type: 'number' },
        },
      },
    },
  };

  const mockToolList = {
    tools: [toolWithArray],
  };

  const clientCode = await generateClientCode('test-pubkey', mockToolList, 'TestServer');

  // Check that the generated code uses proper array types (string[], number[])
  // instead of any[]
  expect(clientCode).toContain('targetPubkeys: string[]');
  expect(clientCode).toContain('weights?: number[]');
  expect(clientCode).toContain(
    'CalculateTrustScores: (targetPubkeys: string[], weights?: number[]) => Promise<CalculateTrustScoresOutput>;'
  );
});
