import { describe, expect, it } from 'vitest';
import { LnBolt11NwcPaymentProcessor } from '@contextvm/sdk';
import { __test__ } from './serve.ts';

const { buildNwcPaymentOptions, resolvePaymentOptions } = __test__;

// Valid NIP-47 shape: <wallet_pubkey(64hex)>?relay=...&secret=<64hex>
const NWC = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss://relay.example.com&secret=${'b'.repeat(64)}`;

describe('buildNwcPaymentOptions', () => {
  it('bundles the NWC processor from the connection string', () => {
    const opts = buildNwcPaymentOptions({
      nwc: NWC,
      pricedCapabilities: [{ method: 'tools/call', name: 'echo', amount: 2, currencyUnit: 'sats' }],
    });
    expect(opts.processors).toHaveLength(1);
    expect(opts.processors[0]).toBeInstanceOf(LnBolt11NwcPaymentProcessor);
  });

  it('passes pricedCapabilities and paymentInteraction straight through', () => {
    const priced = [{ method: 'tools/call', name: 'echo', amount: 5, currencyUnit: 'sats' }];
    const opts = buildNwcPaymentOptions({
      nwc: NWC,
      pricedCapabilities: priced,
      paymentInteraction: 'transparent',
    });
    expect(opts.pricedCapabilities).toBe(priced);
    expect(opts.paymentInteraction).toBe('transparent');
  });
});

describe('resolvePaymentOptions', () => {
  const priced = [{ method: 'tools/call', name: 'echo', amount: 2, currencyUnit: 'sats' }];

  it('returns undefined when no payments are configured (free server)', () => {
    expect(resolvePaymentOptions(undefined, undefined)).toBeUndefined();
  });

  it('throws when payments are configured but nwc is missing or empty', () => {
    expect(() => resolvePaymentOptions({ nwc: '', pricedCapabilities: priced }, undefined)).toThrow(
      /serve\.payments\.nwc/
    );
  });

  it('applies the CVMI_SERVE_PAYMENT_NWC env override over an empty config nwc', () => {
    const opts = resolvePaymentOptions({ nwc: '', pricedCapabilities: priced }, NWC);
    expect(opts?.processors).toHaveLength(1);
    expect(opts?.processors[0]).toBeInstanceOf(LnBolt11NwcPaymentProcessor);
  });
});
