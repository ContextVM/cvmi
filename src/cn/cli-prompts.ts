/**
 * Interactive CLI prompt helpers for the cn sub-command.
 * Manages a shared readline interface for user input.
 */
import * as readline from 'readline';

let rl: readline.Interface | null = null;

function createReadlineInterface(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rl;
}

export function closeReadlineInterface(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

export function askQuestion(query: string, defaultValue: string): Promise<string> {
  const readlineInterface = createReadlineInterface();
  return new Promise((resolve) => {
    try {
      readlineInterface.question(`${query} (${defaultValue}): `, (answer) => {
        resolve(answer || defaultValue);
      });
    } catch (error) {
      console.error('Error reading input:', error);
      resolve(defaultValue);
    }
  });
}

export function askYesNo(query: string, defaultValue: boolean): Promise<boolean> {
  const readlineInterface = createReadlineInterface();
  return new Promise((resolve) => {
    try {
      const defaultStr = defaultValue ? 'Y/n' : 'y/N';
      readlineInterface.question(`${query} (${defaultStr}): `, (answer) => {
        if (!answer) {
          resolve(defaultValue);
        } else {
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        }
      });
    } catch (error) {
      console.error('Error reading input:', error);
      resolve(defaultValue);
    }
  });
}

export function askChoice(
  query: string,
  options: string[],
  defaultIndex: number = 0
): Promise<string> {
  const readlineInterface = createReadlineInterface();
  return new Promise((resolve) => {
    try {
      console.log(query);
      options.forEach((option, index) => {
        const marker = index === defaultIndex ? ' (default)' : '';
        console.log(`  ${index + 1}. ${option}${marker}`);
      });

      readlineInterface.question(`Choose an option (1-${options.length})`, (answer) => {
        const choice = parseInt(answer);
        if (isNaN(choice) || choice < 1 || choice > options.length) {
          resolve(options[defaultIndex] || '');
        } else {
          resolve(options[choice - 1] || '');
        }
      });
    } catch (error) {
      console.error('Error reading input:', error);
      resolve(options[defaultIndex] || '');
    }
  });
}
