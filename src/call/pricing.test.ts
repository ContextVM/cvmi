import { describe, expect, it } from 'vitest';
import { formatPrice, parseCapabilityPricing, type ToolPrice } from './pricing.ts';

const tag = (...t: unknown[]) => t;

describe('parseCapabilityPricing', () => {
  it('returns empty for undefined / malformed events', () => {
    expect(parseCapabilityPricing(undefined)).toEqual({ pmis: [], byTool: new Map() });
    expect(parseCapabilityPricing({})).toEqual({ pmis: [], byTool: new Map() });
    expect(parseCapabilityPricing({ tags: 'nope' })).toEqual({ pmis: [], byTool: new Map() });
  });

  it('collects pmi tags in order', () => {
    const { pmis } = parseCapabilityPricing({
      tags: [tag('pmi', 'bitcoin-lightning-bolt11'), tag('pmi', 'other-rail')],
    });
    expect(pmis).toEqual(['bitcoin-lightning-bolt11', 'other-rail']);
  });

  it('maps cap tool tags by name with the tool: prefix stripped', () => {
    const { byTool } = parseCapabilityPricing({
      tags: [tag('cap', 'tool:relays/list', '2', 'sats')],
    });
    expect(byTool.get('relays/list')).toEqual({ amount: 2, currencyUnit: 'sats' });
  });

  it('parses range pricing into maxAmount', () => {
    const { byTool } = parseCapabilityPricing({
      tags: [tag('cap', 'tool:relays/search', '3-5', 'sats')],
    });
    expect(byTool.get('relays/search')).toEqual({ amount: 3, maxAmount: 5, currencyUnit: 'sats' });
  });

  it('rejects negative and out-of-order range prices', () => {
    const { byTool } = parseCapabilityPricing({
      tags: [
        tag('cap', 'tool:neg', '-5', 'sats'),
        tag('cap', 'tool:backwards', '5-3', 'sats'),
        tag('cap', 'tool:neghi', '3--5', 'sats'),
      ],
    });
    expect(byTool.size).toBe(0);
  });

  it('ignores non-tool cap identifiers (prompt:/resource:) and malformed caps', () => {
    const { byTool } = parseCapabilityPricing({
      tags: [
        tag('cap', 'prompt:get', '1', 'sats'),
        tag('cap', 'resource:uri', '1', 'sats'),
        tag('cap', 'tool:bad', 'not-a-number', 'sats'),
        tag('cap', 'tool:badrange', '1-x', 'sats'),
        tag('cap', 'tool:incomplete'),
      ],
    });
    expect(byTool.size).toBe(0);
  });

  it('keeps the first cap for a duplicated tool name', () => {
    const { byTool } = parseCapabilityPricing({
      tags: [tag('cap', 'tool:x', '2', 'sats'), tag('cap', 'tool:x', '9', 'sats')],
    });
    expect(byTool.get('x')).toEqual({ amount: 2, currencyUnit: 'sats' });
  });
});

describe('formatPrice', () => {
  it('formats a fixed price', () => {
    expect(formatPrice({ amount: 2, currencyUnit: 'sats' } as ToolPrice)).toBe('2 sats');
  });

  it('formats a range price', () => {
    expect(formatPrice({ amount: 2, maxAmount: 5, currencyUnit: 'sats' } as ToolPrice)).toBe(
      '2-5 sats'
    );
  });
});
