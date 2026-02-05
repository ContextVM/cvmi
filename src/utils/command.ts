/**
 * Utilities for dealing with user-provided command strings.
 *
 * Important: `cvmi` executes MCP servers without a shell (argv form).
 * If a user provides a full command as a single string (often due to quoting),
 * we need to split it into executable + args.
 */

/**
 * Split a user-provided command string into argv parts.
 *
 * Supports:
 * - Whitespace separation
 * - Single and double quotes
 * - Backslash escaping (outside quotes and inside double quotes)
 *
 * Note: This is intentionally *not* a full shell parser:
 * - no env expansion ($FOO)
 * - no globbing
 * - no command substitution
 */
export function splitCommandString(input: string): string[] {
  const s = input.trim();
  if (!s) return [];

  const out: string[] = [];
  let cur = '';

  type Quote = 'single' | 'double' | null;
  let quote: Quote = null;

  const push = () => {
    if (cur.length > 0) out.push(cur);
    cur = '';
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;

    // Whitespace splits tokens only when not in quotes.
    if (!quote && /\s/.test(ch)) {
      push();
      while (i + 1 < s.length && /\s/.test(s[i + 1]!)) i++;
      continue;
    }

    // Quote toggles.
    if (!quote && ch === "'") {
      quote = 'single';
      continue;
    }
    if (!quote && ch === '"') {
      quote = 'double';
      continue;
    }
    if (quote === 'single' && ch === "'") {
      quote = null;
      continue;
    }
    if (quote === 'double' && ch === '"') {
      quote = null;
      continue;
    }

    // Backslash escaping.
    // - Outside quotes: escape the next char.
    // - Inside double quotes: also escape the next char.
    // - Inside single quotes: backslash is literal.
    if (ch === '\\') {
      const next = s[i + 1];
      if (next === undefined) {
        cur += ch;
        continue;
      }
      if (!quote || quote === 'double') {
        cur += next;
        i++;
        continue;
      }
    }

    cur += ch;
  }

  push();
  return out;
}

/**
 * Normalize a command+args pair.
 *
 * If `command` contains whitespace, it is treated as a full command string and
 * split into argv. The resulting extra argv parts are prepended to `args`.
 */
export function normalizeCommandAndArgs(
  command: string,
  args: string[]
): { command: string; args: string[] } {
  if (/\s/.test(command)) {
    const parts = splitCommandString(command);
    if (parts.length > 0) {
      return {
        command: parts[0]!,
        args: [...parts.slice(1), ...args],
      };
    }
  }

  return { command, args };
}
