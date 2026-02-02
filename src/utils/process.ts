/**
 * Setup signal handlers for graceful shutdown.
 * @param cleanupFn - Async function to call when shutting down
 */
export function setupShutdownHandler(cleanupFn: () => Promise<void>): void {
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down...`);
    await cleanupFn();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Wait for process termination signals.
 *
 * Useful for long-running commands that want to control shutdown flow without
 * forcing `process.exit()` deep inside a handler.
 */
export function waitForShutdownSignal(): Promise<'SIGINT' | 'SIGTERM'> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => resolve('SIGINT'));
    process.once('SIGTERM', () => resolve('SIGTERM'));
  });
}
