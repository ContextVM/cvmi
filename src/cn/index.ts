import { handleInit } from './commands/init.js';
import { handleAdd } from './commands/add.js';
import { handleUpdate } from './commands/update.js';

export function showCnHelp() {
  console.log(`
cvmi cn - Type-safe TypeScript clients for ContextVM servers

Usage:
  cvmi cn <command> [options]

Commands:
  init                  Initialize a new ContextVM client code project setup
  add <pubkey>          Add a new server and generate its client code
  update [pubkey]       Update client code for a specific server, or all added servers

Global Options:
  -h, --help            Show this help message
  --version             Show the version package
`);
}

export async function runCn(args: string[]) {
  // If no arguments provided or help requested
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    showCnHelp();
    return;
  }

  const command = args[0];
  const cwd = process.cwd();

  try {
    switch (command) {
      case 'init':
        await handleInit(cwd);
        break;

      case 'add':
        if (args.length < 2) {
          console.error("error: missing required argument 'pubkey'");
          process.exit(1);
        }
        await handleAdd(args[1]!, cwd);
        break;

      case 'update':
        await handleUpdate(cwd, args[1]);
        break;

      default:
        console.error(`error: unknown command '${command}'`);
        showCnHelp();
        process.exit(1);
    }
  } catch (err: any) {
    if (err.name === 'ExitPromptError') {
      console.log('Operation cancelled by user.');
    } else {
      console.error(
        'An unexpected error occurred:',
        err instanceof Error ? err.message : String(err)
      );
    }
    process.exit(1);
  }
}
