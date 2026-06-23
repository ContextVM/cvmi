import { describe, it, expect } from 'vitest';
import { canonicalizeManifest, signManifest, verifyManifestSignature } from './crypto.ts';
import type { CvmbManifest } from './cvm-manifest.ts';
import { generatePrivateKey } from '../utils/crypto.ts'; // returns 64-char hex

describe('crypto', () => {
  const dummyManifest: CvmbManifest = {
    manifest_version: '0.3',
    name: 'test-server',
    version: '1.0.0',
    description: 'A test server',
    author: { name: 'Alice' },
    server: {
      type: 'node',
      transport: 'stdio',
      mcp_config: {
        command: 'node',
        args: ['index.js'],
      },
    },
    _meta: {
      'com.contextvm': {
        content_hash: 'sha256:dummyhash',
      },
    },
  };

  it('should canonicalize manifest consistently', () => {
    const json1 = canonicalizeManifest(dummyManifest);
    // Keys should be ordered alphabetically, no whitespace
    expect(json1).toContain('{"_meta":{"com.contextvm":{"content_hash":"sha256:dummyhash"}}');
    expect(json1).toContain('"author":{"name":"Alice"}');
  });

  it('should omit _sig when canonicalizing', () => {
    const signedManifest = {
      ...dummyManifest,
      _sig: {
        pubkey: 'dummy',
        id: 'dummy',
        signature: 'dummy',
        created_at: 12345,
      },
    };
    const json1 = canonicalizeManifest(dummyManifest);
    const json2 = canonicalizeManifest(signedManifest);
    expect(json1).toBe(json2);
  });

  it('should produce a well-formed _sig block', () => {
    const privKey = generatePrivateKey(); // 64-char hex
    const sig = signManifest(dummyManifest, privKey);

    expect(sig.pubkey).toMatch(/^[a-f0-9]{64}$/); // Nostr pubkey (x-only)
    expect(sig.id).toMatch(/^[a-f0-9]{64}$/); // NIP-01 event id (sha256)
    expect(sig.signature).toMatch(/^[a-f0-9]{128}$/); // Schnorr signature
    expect(typeof sig.created_at).toBe('number');
  });

  it('should successfully sign and verify a manifest', async () => {
    const privKey = generatePrivateKey();
    const signedManifest: CvmbManifest = { ...dummyManifest };
    signedManifest._sig = signManifest(signedManifest, privKey);

    // Verification should pass without throwing
    await expect(Promise.resolve(verifyManifestSignature(signedManifest))).resolves.toBe(true);
  });

  it('should fail verification if manifest is tampered', () => {
    const privKey = generatePrivateKey();
    const signedManifest: CvmbManifest = { ...dummyManifest } as CvmbManifest;
    signedManifest._sig = signManifest(signedManifest, privKey);

    // Tamper with the manifest after signing
    signedManifest.version = '1.0.1';

    expect(() => verifyManifestSignature(signedManifest)).toThrow('Invalid manifest signature');
  });

  it('should fail verification if signature is tampered', () => {
    const privKey = generatePrivateKey();
    const signedManifest: CvmbManifest = { ...dummyManifest } as CvmbManifest;
    signedManifest._sig = signManifest(signedManifest, privKey);

    // Tamper with signature
    signedManifest._sig.signature = signedManifest._sig.signature.replace(/0/g, '1');

    expect(() => verifyManifestSignature(signedManifest)).toThrow('Invalid manifest signature');
  });

  it('should fail verification if unsigned', () => {
    expect(() => verifyManifestSignature({ ...dummyManifest })).toThrow('Manifest is not signed');
  });
});
