/**
 * CEP-8 payment discovery for the `call` command.
 *
 * Reads server-advertised payment metadata (`pmi` + `cap` tags) from a Nostr
 * event so the tool list can show accepted payment methods and per-tool pricing.
 *
 * `cap` tags are a discovery/reference surface only — the server's `resolvePrice`
 * sets the final invoice at call time. Callers should present this as advertised
 * pricing, not a guaranteed charge.
 */

/** Minimal structural view of a Nostr event — enough to read tags. */
interface TaggedEvent {
  tags?: unknown[];
}

export interface ToolPrice {
  amount: number;
  maxAmount?: number;
  currencyUnit: string;
}

export interface CapabilityPricing {
  /** Server-advertised payment method identifiers (order preserved). */
  pmis: string[];
  /** Per-tool advertised price, keyed by tool name. */
  byTool: Map<string, ToolPrice>;
}

const PMI_TAG = 'pmi';
const CAP_TAG = 'cap';
const TOOL_PREFIX = 'tool:';

/** Parse `pmi` + `cap` (tool) tags off a Nostr event. Tolerates undefined. */
export function parseCapabilityPricing(event: unknown): CapabilityPricing {
  const pmis: string[] = [];
  const byTool = new Map<string, ToolPrice>();

  const tags = (event as TaggedEvent | null | undefined)?.tags;
  if (!Array.isArray(tags)) return { pmis, byTool };

  for (const tag of tags) {
    if (!Array.isArray(tag)) continue;
    const [kind, ...rest] = tag as unknown[];
    if (kind === PMI_TAG) {
      if (typeof rest[0] === 'string') pmis.push(rest[0]);
      continue;
    }
    if (kind !== CAP_TAG) continue;

    // ['cap', 'tool:<name>', '<price>', '<currencyUnit>']
    const id = rest[0];
    const price = rest[1];
    const currencyUnit = rest[2];
    if (typeof id !== 'string' || !id.startsWith(TOOL_PREFIX)) continue; // ignore prompt:/resource:
    const name = id.slice(TOOL_PREFIX.length);
    if (typeof price !== 'string' || typeof currencyUnit !== 'string') continue;
    if (byTool.has(name)) continue; // first wins; servers shouldn't dupe

    // CEP-8: price is a fixed integer or "<min>-<max>" range (min <= max).
    // A leading dash ("-5") is not a range separator; negatives aren't valid
    // advertised prices (no credit semantics), so reject rather than coerce.
    const dash = price.indexOf('-');
    let amount: number;
    let maxAmount: number | undefined;
    if (dash > 0) {
      const lo = Number(price.slice(0, dash));
      const hi = Number(price.slice(dash + 1));
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo) continue;
      amount = lo;
      maxAmount = hi;
    } else {
      const n = Number(price);
      if (!Number.isFinite(n) || n < 0) continue;
      amount = n;
    }
    byTool.set(name, { amount, maxAmount, currencyUnit });
  }

  return { pmis, byTool };
}

/** Format a tool price: `2 sats` or `2-5 sats`. */
export function formatPrice(price: ToolPrice): string {
  const value =
    price.maxAmount !== undefined ? `${price.amount}-${price.maxAmount}` : `${price.amount}`;
  return `${value} ${price.currencyUnit}`;
}

/** Footnote shown once where any advertised price is displayed. */
export const PRICING_FOOTNOTE = 'Advertised price; final charge confirmed at call time.';
