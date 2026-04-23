import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handleInit = vi.fn();
const handleAdd = vi.fn();
const handleUpdate = vi.fn();

vi.mock('./commands/init.js', () => ({ handleInit }));
vi.mock('./commands/add.js', () => ({ handleAdd }));
vi.mock('./commands/update.js', () => ({ handleUpdate }));

describe('cn command router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`EXIT:${code}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows help when no args are provided', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { runCn } = await import('./index.ts');

    await runCn([]);

    expect(logSpy).toHaveBeenCalled();
    expect(handleInit).not.toHaveBeenCalled();
    expect(handleAdd).not.toHaveBeenCalled();
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('fails when add is called without pubkey', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { runCn } = await import('./index.ts');

    await expect(runCn(['add'])).rejects.toThrow('EXIT:1');

    expect(errorSpy).toHaveBeenCalledWith("error: missing required argument 'pubkey'");
    expect(handleAdd).not.toHaveBeenCalled();
  });

  it('delegates update with optional pubkey', async () => {
    const { runCn } = await import('./index.ts');

    await runCn(['update', 'pubkey-123']);

    expect(handleUpdate).toHaveBeenCalledWith(process.cwd(), 'pubkey-123');
  });

  it('shows help and exits for unknown commands', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { runCn } = await import('./index.ts');

    await expect(runCn(['wat'])).rejects.toThrow('EXIT:1');

    expect(errorSpy).toHaveBeenCalledWith("error: unknown command 'wat'");
    expect(logSpy).toHaveBeenCalled();
  });

  it('converts ExitPromptError to a user-friendly cancellation message', async () => {
    handleInit.mockRejectedValueOnce({ name: 'ExitPromptError' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { runCn } = await import('./index.ts');

    await expect(runCn(['init'])).rejects.toThrow('EXIT:1');

    expect(logSpy).toHaveBeenCalledWith('Operation cancelled by user.');
  });
});
