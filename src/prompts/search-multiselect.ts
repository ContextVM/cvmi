import * as readline from 'readline';
import { Writable } from 'stream';
import pc from 'picocolors';

const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

export interface SearchItem<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface LockedSection<T> {
  title: string;
  items: SearchItem<T>[];
}

export interface SearchMultiselectOptions<T> {
  message: string;
  items: SearchItem<T>[];
  maxVisible?: number;
  initialSelected?: T[];
  required?: boolean;
  lockedSection?: LockedSection<T>;
}

const S_STEP_ACTIVE = pc.green('◆');
const S_STEP_CANCEL = pc.red('■');
const S_STEP_SUBMIT = pc.green('◇');
const S_RADIO_ACTIVE = pc.green('●');
const S_RADIO_INACTIVE = pc.dim('○');
const S_BULLET = pc.green('•');
const S_BAR = pc.dim('│');
const S_BAR_H = pc.dim('─');

export const cancelSymbol = Symbol('cancel');

export async function searchMultiselect<T>(
  options: SearchMultiselectOptions<T>
): Promise<T[] | symbol> {
  const {
    message,
    items,
    maxVisible = 8,
    initialSelected = [],
    required = false,
    lockedSection,
  } = options;

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: silentOutput,
      terminal: false,
    });

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin, rl);

    let query = '';
    let cursor = 0;
    const selected = new Set<T>(initialSelected);
    let lastRenderHeight = 0;

    const lockedValues = lockedSection ? lockedSection.items.map((i) => i.value) : [];

    const filter = (item: SearchItem<T>, q: string): boolean => {
      if (!q) return true;
      const lowerQ = q.toLowerCase();
      return (
        item.label.toLowerCase().includes(lowerQ) ||
        String(item.value).toLowerCase().includes(lowerQ)
      );
    };

    const getFiltered = (): SearchItem<T>[] => items.filter((item) => filter(item, query));

    const clearRender = (): void => {
      if (lastRenderHeight > 0) {
        process.stdout.write(`\x1b[${lastRenderHeight}A`);
        for (let i = 0; i < lastRenderHeight; i++) {
          process.stdout.write('\x1b[2K\x1b[1B');
        }
        process.stdout.write(`\x1b[${lastRenderHeight}A`);
      }
    };

    const render = (state: 'active' | 'submit' | 'cancel' = 'active'): void => {
      clearRender();

      const lines: string[] = [];
      const filtered = getFiltered();
      const icon =
        state === 'active' ? S_STEP_ACTIVE : state === 'cancel' ? S_STEP_CANCEL : S_STEP_SUBMIT;
      lines.push(`${icon}  ${pc.bold(message)}`);

      if (state === 'active') {
        if (lockedSection && lockedSection.items.length > 0) {
          lines.push(`${S_BAR}`);
          const lockedTitle = `${pc.bold(lockedSection.title)} ${pc.dim('── always included')}`;
          lines.push(`${S_BAR}  ${S_BAR_H}${S_BAR_H} ${lockedTitle} ${S_BAR_H.repeat(12)}`);
          for (const item of lockedSection.items) {
            lines.push(`${S_BAR}    ${S_BULLET} ${pc.bold(item.label)}`);
          }
          lines.push(`${S_BAR}`);
          lines.push(
            `${S_BAR}  ${S_BAR_H}${S_BAR_H} ${pc.bold('Additional agents')} ${S_BAR_H.repeat(29)}`
          );
        }

        lines.push(`${S_BAR}  ${pc.dim('Search:')} ${query}${pc.inverse(' ')}`);
        lines.push(`${S_BAR}  ${pc.dim('↑↓ move, space select, enter confirm')}`);
        lines.push(`${S_BAR}`);

        const visibleStart = Math.max(
          0,
          Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible)
        );
        const visibleEnd = Math.min(filtered.length, visibleStart + maxVisible);
        const visibleItems = filtered.slice(visibleStart, visibleEnd);

        if (filtered.length === 0) {
          lines.push(`${S_BAR}  ${pc.dim('No matches found')}`);
        } else {
          for (let i = 0; i < visibleItems.length; i++) {
            const item = visibleItems[i]!;
            const actualIndex = visibleStart + i;
            const isSelected = selected.has(item.value);
            const isCursor = actualIndex === cursor;

            const radio = isSelected ? S_RADIO_ACTIVE : S_RADIO_INACTIVE;
            const label = isCursor ? pc.underline(item.label) : item.label;
            const hint = item.hint ? pc.dim(` (${item.hint})`) : '';
            const prefix = isCursor ? pc.cyan('❯') : ' ';
            lines.push(`${S_BAR} ${prefix} ${radio} ${label}${hint}`);
          }

          const hiddenBefore = visibleStart;
          const hiddenAfter = filtered.length - visibleEnd;
          if (hiddenBefore > 0 || hiddenAfter > 0) {
            const parts: string[] = [];
            if (hiddenBefore > 0) parts.push(`↑ ${hiddenBefore} more`);
            if (hiddenAfter > 0) parts.push(`↓ ${hiddenAfter} more`);
            lines.push(`${S_BAR}  ${pc.dim(parts.join('  '))}`);
          }
        }

        lines.push(`${S_BAR}`);
        const allSelectedLabels = [
          ...(lockedSection ? lockedSection.items.map((i) => i.label) : []),
          ...items.filter((item) => selected.has(item.value)).map((item) => item.label),
        ];
        if (allSelectedLabels.length === 0) {
          lines.push(`${S_BAR}  ${pc.dim('Selected: (none)')}`);
        } else {
          const summary =
            allSelectedLabels.length <= 3
              ? allSelectedLabels.join(', ')
              : `${allSelectedLabels.slice(0, 3).join(', ')} +${allSelectedLabels.length - 3} more`;
          lines.push(`${S_BAR}  ${pc.green('Selected:')} ${summary}`);
        }
        lines.push(`${pc.dim('└')}`);
      } else if (state === 'submit') {
        const allSelectedLabels = [
          ...(lockedSection ? lockedSection.items.map((i) => i.label) : []),
          ...items.filter((item) => selected.has(item.value)).map((item) => item.label),
        ];
        lines.push(`${S_BAR}  ${pc.dim(allSelectedLabels.join(', '))}`);
      } else {
        lines.push(`${S_BAR}  ${pc.strikethrough(pc.dim('Cancelled'))}`);
      }

      process.stdout.write(lines.join('\n') + '\n');
      lastRenderHeight = lines.length;
    };

    const cleanup = (): void => {
      process.stdin.removeListener('keypress', keypressHandler);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      rl.close();
    };

    const submit = (): void => {
      if (required && selected.size === 0 && lockedValues.length === 0) return;
      render('submit');
      cleanup();
      resolve([...lockedValues, ...Array.from(selected)]);
    };

    const cancel = (): void => {
      render('cancel');
      cleanup();
      resolve(cancelSymbol);
    };

    const keypressHandler = (_str: string, key: readline.Key): void => {
      if (!key) return;
      const filtered = getFiltered();

      if (key.name === 'return') return submit();
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) return cancel();
      if (key.name === 'up') {
        cursor = Math.max(0, cursor - 1);
        return render();
      }
      if (key.name === 'down') {
        cursor = Math.min(filtered.length - 1, cursor + 1);
        return render();
      }
      if (key.name === 'space') {
        const item = filtered[cursor];
        if (item) {
          if (selected.has(item.value)) selected.delete(item.value);
          else selected.add(item.value);
        }
        return render();
      }
      if (key.name === 'backspace') {
        query = query.slice(0, -1);
        cursor = 0;
        return render();
      }

      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        query += key.sequence;
        cursor = 0;
        return render();
      }
    };

    process.stdin.on('keypress', keypressHandler);
    render();
  });
}
