import { afterEach, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { discover } from './discover.ts';
const state = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('nostr-tools', async (original) => ({
  ...(await original<typeof import('nostr-tools')>()),
  SimplePool: class {
    async querySync() {
      return state.events;
    }
    close() {}
  },
}));
afterEach(() => vi.restoreAllMocks());
it('T08: exposes signed presence-only encryption and ephemeral support in raw discovery', async () => {
  const event = finalizeEvent(
    {
      kind: 11316,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['support_encryption'], ['support_encryption_ephemeral']],
      content: '{}',
    },
    generateSecretKey()
  );
  state.events = [event];
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await discover({ raw: true, relays: ['wss://relay.example.com'] });
  const result = JSON.parse(String(log.mock.calls[0]?.[0]));
  expect(result).toHaveLength(1);
  expect(result[0].supportsEncryption).toBe(true);
  expect(result[0].supportsEphemeralEncryption).toBe(true);
});

async function output(events: unknown[]) {
  state.events = events;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await discover({ raw: true, relays: ['wss://relay.example.com'] });
  return JSON.parse(String(log.mock.calls[0]?.[0]));
}
const testKey = generateSecretKey();
const makeEvent = (extra: Record<string, unknown> = {}) =>
  finalizeEvent(
    { kind: 11316, created_at: Math.floor(Date.now() / 1000), tags: [], content: '{}', ...extra },
    testKey
  );
it('ignores signed null display metadata without crashing', async () =>
  expect(await output([makeEvent({ content: 'null' })])).toHaveLength(1));
it('does not show a forged event as verified discovery', async () => {
  const e = makeEvent();
  e.sig = '0'.repeat(128);
  expect(await output([e])).toEqual([]);
});
it('does not revive older discovery after latest signed expiry', async () => {
  const now = Math.floor(Date.now() / 1000);
  expect(
    await output([
      makeEvent({ created_at: now - 60 }),
      makeEvent({ tags: [['expiration', String(now)]] }),
    ])
  ).toEqual([]);
});
it('omits unsupported ephemeral inference from valued legacy tags', async () => {
  const data = await output([
    makeEvent({
      tags: [
        ['support_encryption', 'true'],
        ['support_encryption_ephemeral', 'true'],
      ],
    }),
  ]);
  expect(data[0].supportsEncryption).toBe(true);
  expect(data[0].supportsEphemeralEncryption).toBe(false);
});
it('does not execute or follow a website in the display record', async () => {
  const data = await output([
    makeEvent({
      content: JSON.stringify({ website: 'https://untrusted.invalid/execute', name: 'data only' }),
    }),
  ]);
  expect(data[0].website).toBe('https://untrusted.invalid/execute');
});
it('rejects future display metadata', async () =>
  expect(await output([makeEvent({ created_at: Math.floor(Date.now() / 1000) + 61 })])).toEqual(
    []
  ));

it('ignores an oversized discovery record without hiding valid candidates', async () => {
  const oversized = makeEvent({ content: 'x'.repeat(70000) });
  expect(await output([oversized, makeEvent()])).toHaveLength(1);
});
