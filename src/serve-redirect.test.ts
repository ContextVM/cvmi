import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { __test__ } from './serve.ts';

const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('serve HTTP transport', () => {
  it.each(['cross-origin', 'same-origin'])(
    'refuses %s redirects for POST, GET and DELETE',
    async (kind) => {
      const leaked = vi.fn();
      const second = await listen(
        createServer((req, res) => {
          leaked(req.headers, req.method);
          res.writeHead(200).end();
        })
      );
      let redirect = false;
      const methods: string[] = [];
      let first: string;
      first = await listen(
        createServer((req, res) => {
          if (req.url === '/redirected') {
            leaked(req.headers, req.method);
            res.writeHead(200).end();
          } else if (redirect) {
            methods.push(req.method ?? 'GET');
            res
              .writeHead(307, {
                location: `${kind === 'cross-origin' ? second : first}/redirected`,
              })
              .end();
          } else {
            res.writeHead(200, {
              'content-type': 'application/json',
              'mcp-session-id': 'synthetic-session',
            });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
          }
        })
      );
      const transport = __test__.createStreamableHttpMcpTransport(first);
      await transport.start();
      try {
        await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
        redirect = true;
        await expect(
          transport.send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'test', arguments: { secret: 'synthetic' } },
          })
        ).rejects.toThrow();
        // A resumption token uses the transport's GET path without a preceding POST.
        await transport.send(
          { jsonrpc: '2.0', id: 3, method: 'ping' },
          { resumptionToken: 'test' }
        );
        await vi.waitFor(() => expect(methods).toContain('GET'));
        await expect(transport.terminateSession()).rejects.toThrow();
        expect(methods).toContain('DELETE');
        expect(leaked).not.toHaveBeenCalled();
      } finally {
        await transport.close();
      }
    }
  );

  it('keeps direct POST and DELETE session handling', async () => {
    const methods: string[] = [];
    const origin = await listen(
      createServer((req, res) => {
        methods.push(req.method ?? 'GET');
        if (req.method === 'DELETE') {
          expect(req.headers['mcp-session-id']).toBe('synthetic-session');
          res.writeHead(200).end();
        } else {
          res.writeHead(200, {
            'content-type': 'application/json',
            'mcp-session-id': 'synthetic-session',
          });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
        }
      })
    );
    const transport = __test__.createStreamableHttpMcpTransport(origin);
    await transport.start();
    try {
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      await transport.terminateSession();
      expect(methods).toEqual(['POST', 'DELETE']);
    } finally {
      await transport.close();
    }
  });

  it('aborts hanging GETs after three seconds and falls back to POST-only', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const transport = __test__.createStreamableHttpMcpTransport('https://example.com/mcp');
    const onerror = vi.fn();
    transport.onerror = onerror;
    await transport.start();
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }, { resumptionToken: 'test' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(onerror).not.toHaveBeenCalled();
    await transport.close();
  });
});
