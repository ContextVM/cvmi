import { describe, expect, it } from 'vitest';

import { __test__ } from './serve.ts';

describe('serve transport selection', () => {
  it('detects http(s) urls', () => {
    expect(__test__.isHttpUrl('https://example.com/mcp')).toBe(true);
    expect(__test__.isHttpUrl('http://localhost:3000/mcp')).toBe(true);
    expect(__test__.isHttpUrl('npx')).toBe(false);
  });

  it('creates stdio transport for non-http targets', () => {
    const transport = __test__.createStdioMcpTransport('npx', ['-y', 'x']);
    expect(transport).toBeDefined();
  });
});
