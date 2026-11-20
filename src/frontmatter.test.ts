import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFrontmatter } from './frontmatter.ts';
import { parseSkillMd } from './skills.ts';
import { HuggingFaceProvider } from './providers/huggingface.ts';
import { MintlifyProvider } from './providers/mintlify.ts';
import { WellKnownProvider } from './providers/wellknown.ts';

afterEach(() => vi.unstubAllGlobals());

describe('skill frontmatter', () => {
  it.each(['', 'yaml', 'yml', 'json'])('keeps %s data frontmatter', (language) => {
    const metadata = language === 'json' ? '{"name":"safe"}' : 'name: safe';
    expect(parseSkillFrontmatter(`---${language}\n${metadata}\n---\nbody`).data.name).toBe('safe');
  });

  it.each(['js', 'javascript', 'JS', 'JavaScript'])(
    'rejects %s without executing it',
    (language) => {
      vi.stubGlobal('__cvmiFrontmatterExecuted', false);
      const content = `---${language}\n({name: 'unsafe', marker: (globalThis.__cvmiFrontmatterExecuted = true)})\n---\nbody`;
      expect(() => parseSkillFrontmatter(content)).toThrow(/JavaScript/);
      expect(Reflect.get(globalThis, '__cvmiFrontmatterExecuted')).toBe(false);
    }
  );

  it('rejects executable metadata in local and remote skills', async () => {
    vi.stubGlobal('__cvmiFrontmatterExecuted', false);
    const content = `---js\n({name: 'unsafe', description: 'unsafe', metadata: {'mintlify-proj': 'example'}, marker: (globalThis.__cvmiFrontmatterExecuted = true)})\n---\nbody`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(content))
    );
    const dir = await mkdtemp(join(tmpdir(), 'cvmi-frontmatter-'));
    try {
      const path = join(dir, 'SKILL.md');
      await writeFile(path, content);
      expect(await parseSkillMd(path)).toBeNull();
      expect(
        await new HuggingFaceProvider().fetchSkill(
          'https://huggingface.co/spaces/a/b/raw/main/SKILL.md'
        )
      ).toBeNull();
      expect(await new MintlifyProvider().fetchSkill('https://example.com/skill.md')).toBeNull();
      expect(
        await new WellKnownProvider().fetchSkillByEntry('https://example.com', {
          name: 'unsafe',
          description: 'unsafe',
          files: ['SKILL.md'],
        })
      ).toBeNull();
      expect(Reflect.get(globalThis, '__cvmiFrontmatterExecuted')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
