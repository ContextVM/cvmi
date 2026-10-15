import { describe, expect, it } from 'vitest';
import { GiftWrapMode } from '@contextvm/sdk';
import { __test__, parseCallArgs } from './call.ts';
const key = 'a'.repeat(64);
describe('automatic prehandshake policy is separately opt-in', () => {
  it('does not enable auto by omission', () =>
    expect(parseCallArgs([key]).autoGiftWrap).toBeUndefined());
  it('supports generic opt-in without selecting the server wrap mode', () =>
    expect(parseCallArgs([key, '--auto-gift-wrap'])).toMatchObject({
      autoGiftWrap: true,
      giftWrapMode: undefined,
      unknownFlags: [],
    }));
  it('supports explicit opt-out', () =>
    expect(parseCallArgs([key, '--no-auto-gift-wrap']).autoGiftWrap).toBe(false));
  it('last auto boolean flag wins', () =>
    expect(parseCallArgs([key, '--auto-gift-wrap', '--no-auto-gift-wrap']).autoGiftWrap).toBe(
      false
    ));
  it('an explicit transport mode remains independent of auto enablement', () =>
    expect(parseCallArgs([key, '--auto-gift-wrap', '--gift-wrap-mode', 'optional'])).toMatchObject({
      autoGiftWrap: true,
      giftWrapMode: GiftWrapMode.OPTIONAL,
    }));
  it('uses a shared opt-in configuration', () =>
    expect(
      __test__.resolveServerTarget({ use: { autoGiftWrap: true } }, key, {}).autoGiftWrap
    ).toBe(true));
  it('CLI false overrides alias and shared true', () =>
    expect(
      __test__.resolveServerTarget(
        { use: { autoGiftWrap: true }, servers: { service: { pubkey: key, autoGiftWrap: true } } },
        'service',
        { autoGiftWrap: false }
      ).autoGiftWrap
    ).toBe(false));
  it('alias false overrides shared true', () =>
    expect(
      __test__.resolveServerTarget(
        { use: { autoGiftWrap: true }, servers: { service: { pubkey: key, autoGiftWrap: false } } },
        'service',
        {}
      ).autoGiftWrap
    ).toBe(false));
  it('retains a configured explicit mode so it overrides auto', () =>
    expect(
      __test__.resolveServerTarget(
        { use: { autoGiftWrap: true, giftWrapMode: GiftWrapMode.PERSISTENT } },
        key,
        {}
      )
    ).toMatchObject({ autoGiftWrap: true, giftWrapMode: GiftWrapMode.PERSISTENT }));
  it.each(['true', 1, {}, []])('rejects malformed effective auto configuration %j', (value) =>
    expect(() =>
      __test__.resolveServerTarget({ use: { autoGiftWrap: value } } as never, key, {})
    ).toThrow('Invalid autoGiftWrap')
  );
});
