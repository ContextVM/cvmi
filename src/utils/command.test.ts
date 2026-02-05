import { describe, expect, it } from 'vitest';

import { normalizeCommandAndArgs, splitCommandString } from './command.ts';

describe('utils/command', () => {
  describe('splitCommandString', () => {
    it('splits simple whitespace', () => {
      expect(splitCommandString('npx -y pkg /tmp')).toEqual(['npx', '-y', 'pkg', '/tmp']);
    });

    it('supports double quotes (including spaces)', () => {
      expect(splitCommandString('npx -y "@scope/pkg" "/my dir"')).toEqual([
        'npx',
        '-y',
        '@scope/pkg',
        '/my dir',
      ]);
    });

    it('supports single quotes', () => {
      expect(splitCommandString("python -c 'print(1)'")).toEqual(['python', '-c', 'print(1)']);
    });
  });

  describe('normalizeCommandAndArgs', () => {
    it('splits a command string and prepends argv parts', () => {
      expect(normalizeCommandAndArgs('npx -y pkg', ['/tmp'])).toEqual({
        command: 'npx',
        args: ['-y', 'pkg', '/tmp'],
      });
    });

    it('leaves already-normalized command+args alone', () => {
      expect(normalizeCommandAndArgs('npx', ['-y', 'pkg'])).toEqual({
        command: 'npx',
        args: ['-y', 'pkg'],
      });
    });
  });
});
