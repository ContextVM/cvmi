import { promises as fs } from 'fs';
import path from 'path';
import { DEFAULT_CN_CONFIG, type CnConfig, CN_CONFIG_FILENAME } from '../config.js';
import { askQuestion, closeReadlineInterface } from '../cli-prompts.js';
import { ensureDirectoryExists, fileExists } from '../file-operations.js';

export async function handleInit(cwd: string) {
  console.log('Initializing project for cvmi cn...');

  console.log('\nVerifying project structure...');
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!(await fileExists(packageJsonPath))) {
    console.error(
      '✗ Validation Error: No package.json found. Please run this command in a valid project root directory.'
    );
    process.exit(1);
  }
  console.log('✓ Project structure seems valid (package.json found).');

  const configPath = path.join(cwd, CN_CONFIG_FILENAME);
  if (await fileExists(configPath)) {
    const overwrite = await askQuestion(
      `A \`${CN_CONFIG_FILENAME}\` file already exists. Do you want to overwrite it?`,
      'n'
    );
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Aborting initialization. Your existing configuration is safe.');
      process.exit(0);
    }
  }

  console.log('\nPlease provide your configuration details:');
  const source = await askQuestion(
    'Enter the source directory for generated clients',
    DEFAULT_CN_CONFIG.source
  );
  const relaysStr = await askQuestion(
    'Enter the relays to connect to (comma-separated)',
    DEFAULT_CN_CONFIG.relays.join(', ')
  );
  const relays = relaysStr.split(',').map((r) => r.trim());

  closeReadlineInterface();

  const config: CnConfig = {
    source,
    relays,
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`\n✓ Configuration file \`${CN_CONFIG_FILENAME}\` created successfully.`);

  const sourceDir = path.join(cwd, config.source);
  await ensureDirectoryExists(sourceDir);
  console.log(`✓ Source directory \`${config.source}\` created.`);

  console.log('\nChecking for required dependencies...');
  const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageJsonContent);
  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};

  if (!dependencies['@contextvm/sdk'] && !devDependencies['@contextvm/sdk']) {
    console.warn(
      '! The `@contextvm/sdk` dependency is not found in your `package.json`. Please install it to ensure the generated client works correctly.'
    );
  } else {
    console.log('✓ The `@contextvm/sdk` dependency is already installed.');
  }

  console.log('\n✓ Project initialization complete. You can now use the `cvmi cn add` command.');
}
