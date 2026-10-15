import { EncryptionMode, GiftWrapMode, ensureWebSocket } from '@contextvm/sdk';
import { nip19, verifyEvent, type Event } from 'nostr-tools';

/** Local opt-in policy limits, not universal protocol requirements. */
export const ANNOUNCEMENT_LIMITS = Object.freeze({
  maxEvents: 64,
  maxEventBytes: 65536,
  maxFrameBytes: 69632,
  maxQueryBytes: 1048576,
  maxFrames: 128,
  maxRelays: 3,
  deadlineMs: 4000,
  maxAgeSeconds: 86400,
  futureSkewSeconds: 60,
});
export class AnnouncementError extends Error {
  constructor(public readonly code: string) {
    super(
      `${code}: secure prehandshake selection stopped; no MCP request was sent. Check the selected relay or use an explicitly reviewed gift-wrap policy.`
    );
    this.name = 'AnnouncementError';
  }
}
const fail = (code: string): never => {
  throw new AnnouncementError(code);
};
export function announcementPubkey(input: string): string {
  if (/^[a-f0-9]{64}$/i.test(input)) return input.toLowerCase();
  try {
    const d = nip19.decode(input);
    if (d.type === 'npub') return d.data;
    if (d.type === 'nprofile') return d.data.pubkey;
  } catch {
    /* Never include peer-controlled text in diagnostics. */
  }
  return fail('INVALID_TARGET_KEY');
}
export type WrapDecision = {
  mode?: GiftWrapMode;
  firstOuterKind: 1059 | 21059;
  basis: 'explicit' | 'legacy_default' | 'signed_prehandshake_support';
  eventId?: string;
  createdAt?: number;
  target: string;
};
export function presenceCapabilities(tags: string[][]): {
  supportsEncryption: boolean;
  supportsEphemeralEncryption: boolean;
} {
  const flag = (name: string) => {
    const entries = tags.filter((t) => t[0] === name);
    if (entries.length > 1 || entries.some((t) => t.length !== 1)) fail('MALFORMED_CAPABILITY');
    return entries.length === 1;
  };
  return {
    supportsEncryption: flag('support_encryption'),
    supportsEphemeralEncryption: flag('support_encryption_ephemeral'),
  };
}
function expiryOf(event: Event): number | undefined {
  const tags = event.tags.filter((t) => t[0] === 'expiration');
  if (tags.length > 1 || tags.some((t) => t.length !== 2 || !/^(0|[1-9][0-9]*)$/.test(t[1]!))) {
    fail('MALFORMED_EXPIRATION');
  }
  if (!tags.length) return undefined;
  const n = Number(tags[0]![1]);
  if (!Number.isSafeInteger(n)) fail('MALFORMED_EXPIRATION');
  return n;
}
/** Return a fresh canonical wire object, never a caller-supplied cached verification. */
export function verifiedAnnouncement(raw: unknown): Event | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 11316 || typeof r.pubkey !== 'string' || !/^[a-f0-9]{64}$/.test(r.pubkey))
    return undefined;
  try {
    const wire = JSON.stringify({
      id: r.id,
      pubkey: r.pubkey,
      kind: r.kind,
      created_at: r.created_at,
      tags: r.tags,
      content: r.content,
      sig: r.sig,
    });
    if (Buffer.byteLength(wire) > ANNOUNCEMENT_LIMITS.maxEventBytes) fail('ANNOUNCEMENT_LIMIT');
    const event = JSON.parse(wire) as Event;
    if (
      !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 ||
      !Array.isArray(event.tags) ||
      event.tags.length > 128 ||
      !event.tags.every(
        (t) => Array.isArray(t) && t.every((x) => typeof x === 'string' && x.length <= 2048)
      ) ||
      typeof event.content !== 'string' ||
      !/^[a-f0-9]{64}$/.test(event.id) ||
      !/^[a-f0-9]{128}$/.test(event.sig) ||
      !verifyEvent(event)
    )
      return undefined;
    return event;
  } catch (error) {
    if (error instanceof AnnouncementError) throw error;
    return undefined;
  }
}
/** Display discovery: verify latest signed records before expiry, without treating prose as trust. */
export function currentDiscoveryEvents(
  raw: readonly unknown[],
  now = Math.floor(Date.now() / 1000)
): Event[] {
  const latest = new Map<string, Event>();
  for (const item of raw) {
    let event: Event | undefined;
    try {
      event = verifiedAnnouncement(item);
    } catch {
      continue;
    }
    if (!event) continue;
    const previous = latest.get(event.pubkey);
    if (
      !previous ||
      event.created_at > previous.created_at ||
      (event.created_at === previous.created_at && event.id < previous.id)
    )
      latest.set(event.pubkey, event);
  }
  return [...latest.values()].filter((event) => {
    try {
      const expiry = expiryOf(event);
      return (
        event.created_at <= now + ANNOUNCEMENT_LIMITS.futureSkewSeconds &&
        now - event.created_at <= ANNOUNCEMENT_LIMITS.maxAgeSeconds &&
        (expiry === undefined || (expiry > now && expiry > event.created_at))
      );
    } catch {
      return false;
    }
  });
}

export function selectInitialWrap(input: {
  target: string;
  explicitMode?: GiftWrapMode;
  autoEnabled: boolean;
  encryption: EncryptionMode;
  events: readonly unknown[];
  now: number;
}): WrapDecision {
  const target = announcementPubkey(input.target);
  const explicit = input.explicitMode;
  if (explicit !== undefined) {
    if (!Object.values(GiftWrapMode).includes(explicit)) fail('INVALID_EXPLICIT_MODE');
    return {
      target,
      mode: explicit,
      firstOuterKind: explicit === GiftWrapMode.EPHEMERAL ? 21059 : 1059,
      basis: 'explicit',
    };
  }
  if (!input.autoEnabled) return { target, basis: 'legacy_default', firstOuterKind: 1059 };
  if (input.encryption !== EncryptionMode.REQUIRED) fail('AUTO_REQUIRES_ENCRYPTION_REQUIRED');
  if (!Number.isSafeInteger(input.now) || input.now < 0) fail('INVALID_LOCAL_CLOCK');
  if (!Array.isArray(input.events) || input.events.length > ANNOUNCEMENT_LIMITS.maxEvents)
    fail('ANNOUNCEMENT_LIMIT');
  const valid = new Map<string, Event>();
  let invalid = false;
  for (const raw of input.events) {
    if (!raw || typeof raw !== 'object') {
      invalid = true;
      continue;
    }
    const r = raw as Record<string, unknown>;
    if (r.kind !== 11316 || r.pubkey !== target) continue;
    const event = verifiedAnnouncement(raw);
    if (!event) {
      invalid = true;
      continue;
    }
    valid.set(event.id, event);
  }
  if (!valid.size) fail(invalid ? 'INVALID_SIGNATURE_OR_ID' : 'ANNOUNCEMENT_NOT_FOUND');
  // Pick the latest AUTHENTIC record before applying expiry; never resurrect a superseded old record.
  const events = [...valid.values()].sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)
  );
  const latest = events[0]!;
  if (latest.created_at > input.now + ANNOUNCEMENT_LIMITS.futureSkewSeconds)
    fail('ANNOUNCEMENT_FUTURE');
  if (input.now - latest.created_at > ANNOUNCEMENT_LIMITS.maxAgeSeconds) fail('ANNOUNCEMENT_STALE');
  const expiry = expiryOf(latest);
  if (expiry !== undefined && (expiry <= input.now || expiry <= latest.created_at))
    fail('ANNOUNCEMENT_EXPIRED');
  const capabilities = presenceCapabilities(latest.tags);
  const fingerprint = JSON.stringify([capabilities, expiry]);
  for (const tied of events.filter((e) => e.created_at === latest.created_at)) {
    if (JSON.stringify([presenceCapabilities(tied.tags), expiryOf(tied)]) !== fingerprint)
      fail('ANNOUNCEMENT_CONFLICT');
  }
  if (!capabilities.supportsEncryption && !capabilities.supportsEphemeralEncryption)
    fail('NO_COMPATIBLE_WRAP_PROVEN');
  const mode = capabilities.supportsEphemeralEncryption
    ? GiftWrapMode.EPHEMERAL
    : GiftWrapMode.PERSISTENT;
  return {
    target,
    mode,
    firstOuterKind: mode === GiftWrapMode.EPHEMERAL ? 21059 : 1059,
    basis: 'signed_prehandshake_support',
    eventId: latest.id,
    createdAt: latest.created_at,
  };
}

export type RelayObservation = {
  url: string;
  complete: boolean;
  events: unknown[];
  frames: number;
  bytes: number;
  errorCode?: string;
};
/** Public read only: REQ/CLOSE only; no relay authentication, publication, or peer URL following. */
export async function queryAnnouncements(
  targetInput: string,
  relayInputs: readonly string[]
): Promise<RelayObservation[]> {
  const target = announcementPubkey(targetInput);
  const relays = [
    ...new Set(
      relayInputs.map((raw) => {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          return fail('INVALID_RELAY');
        }
        if (
          url.username ||
          url.password ||
          url.hash ||
          url.search ||
          !(
            url.protocol === 'wss:' ||
            (url.protocol === 'ws:' && ['127.0.0.1', '[::1]'].includes(url.hostname))
          )
        )
          fail('INVALID_RELAY');
        return url.toString();
      })
    ),
  ];
  if (!relays.length || relays.length > ANNOUNCEMENT_LIMITS.maxRelays) fail('INVALID_RELAY_SET');
  let WebSocketImpl: ReturnType<typeof ensureWebSocket>;
  try {
    WebSocketImpl = ensureWebSocket();
  } catch {
    return fail('WEBSOCKET_UNAVAILABLE');
  }
  return Promise.all(
    relays.map(
      (url) =>
        new Promise<RelayObservation>((resolve) => {
          const result: RelayObservation = {
            url,
            complete: false,
            events: [],
            frames: 0,
            bytes: 0,
          };
          const id = 'cvmi-prehandshake';
          let settled = false;
          let ws: InstanceType<typeof WebSocketImpl> | undefined;
          const timer = setTimeout(
            () => finish('ANNOUNCEMENT_QUERY_TIMEOUT'),
            ANNOUNCEMENT_LIMITS.deadlineMs
          );
          function finish(errorCode?: string) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (errorCode) result.errorCode = errorCode;
            if (ws) {
              ws.onmessage = null;
              ws.onopen = null;
              ws.onclose = null;
              ws.onerror = () => {};
              try {
                if (ws.readyState === 1) ws.send(JSON.stringify(['CLOSE', id]));
                ws.close();
              } catch {
                /* Bound terminal cleanup. */
              }
            }
            resolve(result);
          }
          try {
            ws = new WebSocketImpl(url);
          } catch {
            finish('ANNOUNCEMENT_QUERY_UNAVAILABLE');
            return;
          }
          ws.onopen = () => {
            try {
              ws!.send(
                JSON.stringify(['REQ', id, { kinds: [11316], authors: [target], limit: 64 }])
              );
            } catch {
              finish('ANNOUNCEMENT_QUERY_UNAVAILABLE');
            }
          };
          ws.onclose = () => finish('ANNOUNCEMENT_QUERY_INCOMPLETE');
          ws.onerror = () => finish('ANNOUNCEMENT_QUERY_UNAVAILABLE');
          ws.onmessage = (message) => {
            if (settled) return;
            if (typeof message.data !== 'string') {
              finish('MALFORMED_RELAY_FRAME');
              return;
            }
            const size = Buffer.byteLength(message.data);
            result.frames++;
            result.bytes += size;
            if (
              size > ANNOUNCEMENT_LIMITS.maxFrameBytes ||
              result.bytes > ANNOUNCEMENT_LIMITS.maxQueryBytes ||
              result.frames > ANNOUNCEMENT_LIMITS.maxFrames
            ) {
              finish('ANNOUNCEMENT_LIMIT');
              return;
            }
            let frame: unknown;
            try {
              frame = JSON.parse(message.data);
            } catch {
              finish('MALFORMED_RELAY_FRAME');
              return;
            }
            if (!Array.isArray(frame)) {
              finish('MALFORMED_RELAY_FRAME');
              return;
            }
            if (frame[0] === 'EOSE' && frame[1] === id) {
              result.complete = true;
              finish();
            } else if (frame[0] === 'EVENT' && frame[1] === id) {
              if (frame.length !== 3 || result.events.length >= ANNOUNCEMENT_LIMITS.maxEvents) {
                finish('ANNOUNCEMENT_LIMIT');
                return;
              }
              result.events.push(frame[2]);
            } else if (frame[0] === 'CLOSED' && frame[1] === id)
              finish('ANNOUNCEMENT_QUERY_REJECTED');
            else if (frame[0] === 'AUTH') finish('RELAY_AUTH_NOT_AUTHORIZED');
            // Notices and irrelevant subscriptions never become instructions or selection evidence.
          };
        })
    )
  );
}
export async function resolveInitialWrap(input: {
  target: string;
  relays: readonly string[];
  explicitMode?: GiftWrapMode;
  autoEnabled: boolean;
  encryption: EncryptionMode;
}): Promise<WrapDecision> {
  if (input.explicitMode !== undefined || !input.autoEnabled)
    return selectInitialWrap({ ...input, events: [], now: Math.floor(Date.now() / 1000) });
  if (input.encryption !== EncryptionMode.REQUIRED) fail('AUTO_REQUIRES_ENCRYPTION_REQUIRED');
  const observations = await queryAnnouncements(input.target, input.relays);
  const failed = observations.find((r) => !r.complete || r.errorCode);
  if (failed) fail(failed.errorCode ?? 'ANNOUNCEMENT_QUERY_INCOMPLETE');
  const unique = new Map<string, unknown>();
  for (const record of observations)
    for (const event of record.events) {
      // Deduplicate canonical bytes, not peer-supplied IDs: one forged ID must not hide a valid event.
      const key = JSON.stringify(event);
      unique.set(key, event);
    }
  return selectInitialWrap({
    ...input,
    events: [...unique.values()],
    now: Math.floor(Date.now() / 1000),
  });
}
