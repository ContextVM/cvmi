import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { __test__ } from './use.ts';

function announcement(tags: string[][]): Event {
  return {
    id: 'event-id',
    pubkey: 'a'.repeat(64),
    created_at: 1,
    kind: 11316,
    tags,
    content: '{}',
    sig: 'signature',
  } as Event;
}

describe('resolveProxyPaymentOptions', () => {
  it('does not force payment negotiation by default', () => {
    expect(__test__.resolveProxyPaymentOptions(undefined)).toBeUndefined();
  });

  it('forwards an explicitly selected payment mode', () => {
    expect(__test__.resolveProxyPaymentOptions('transparent')).toEqual({
      paymentInteraction: 'transparent',
    });
    expect(__test__.resolveProxyPaymentOptions('explicit_gating')).toEqual({
      paymentInteraction: 'explicit_gating',
    });
  });
});

describe('resolveDefaultPaymentMode', () => {
  it('requests explicit gating when the announcement advertises it', async () => {
    const mode = await __test__.resolveDefaultPaymentMode(
      ['wss://relay.example.com'],
      'a'.repeat(64),
      async () => announcement([['payment_interaction', 'explicit_gating']])
    );
    expect(mode).toBe('explicit_gating');
  });

  it('leaves negotiation unset for unpriced or legacy servers', async () => {
    const noTag = await __test__.resolveDefaultPaymentMode(
      ['wss://relay.example.com'],
      'a'.repeat(64),
      async () => announcement([['support_encryption']])
    );
    expect(noTag).toBeUndefined();

    const noAnnouncement = await __test__.resolveDefaultPaymentMode(
      ['wss://relay.example.com'],
      'a'.repeat(64),
      async () => undefined
    );
    expect(noAnnouncement).toBeUndefined();
  });

  it('falls back to the compat default when the lookup fails', async () => {
    const mode = await __test__.resolveDefaultPaymentMode(
      ['wss://relay.example.com'],
      'a'.repeat(64),
      async () => {
        throw new Error('relay unreachable');
      }
    );
    expect(mode).toBeUndefined();
  });
});
