import { describe, expect, it } from 'vitest';
import { __test__ } from './use.ts';

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
