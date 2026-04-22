import path from 'path';
import { toPascalCase } from '../utils.js';
import { loadCnConfig, saveCnConfig } from '../config.js';
import { askQuestion, closeReadlineInterface } from '../cli-prompts.js';
import { generateClientCode } from '../schema.js';
import { createCvmConnection } from '../cvm-client.js';
import { fileExists, writeFileWithDir } from '../file-operations.js';

export async function handleAdd(pubkey: string, cwd: string) {
  console.log('Checking for configuration file...');

  // Check if config file exists
  const configPath = path.join(cwd, '.cvmi-cn.json');
  if (!(await fileExists(configPath))) {
    closeReadlineInterface();
    console.error("✗ Error: Configuration file '.cvmi-cn.json' not found.");
    console.error("Please run 'cvmi cn init' first to create a configuration file.");
    process.exit(1);
  }

  const config = await loadCnConfig(cwd);

  // Check if client is already added
  if (config.addedClients && config.addedClients.includes(pubkey)) {
    console.log(`! Client with pubkey ${pubkey} is already added.`);

    const choice = await askQuestion('Would you like to update this client? (y/n)', 'n');

    if (choice.toLowerCase() !== 'y' && choice.toLowerCase() !== 'yes') {
      console.log('✗ Operation cancelled.');
      closeReadlineInterface();
      process.exit(0);
    }

    console.log('Updating existing client...');
  }

  console.log(`Connecting to server ${pubkey}...`);

  try {
    const { serverDetails, toolListResult } = await createCvmConnection(
      pubkey,
      config,
      'generator-client'
    );
    let serverName = toPascalCase(serverDetails?.name || 'UnknownServer');

    // Interactive confirmation
    console.log(`\nServer Information:`);
    console.log(`   Name: ${serverDetails?.name || 'Unknown'}`);
    console.log(`   Version: ${serverDetails?.version || 'Unknown'}`);
    console.log(`   Tools found: ${toolListResult.tools.length}`);

    console.log(`\nAvailable Tools:`);
    toolListResult.tools.forEach((tool: any, index: number) => {
      console.log(`   ${index + 1}. ${tool.name}: ${tool.description || 'No description'}`);
    });

    console.log(`\nClient Configuration:`);
    console.log(`   Client Name: ${serverName}Client`);
    console.log(`   Output Directory: ${config.source}`);

    // Allow user to change client name
    const customName = await askQuestion(
      'Enter custom client name (leave empty to use default)',
      ''
    );
    if (customName.trim()) {
      serverName = toPascalCase(customName.trim());
    }

    // Confirmation options
    console.log('\nWhat would you like to do?');
    console.log('1. Generate and save the client file');
    console.log('2. Print the generated code to console only');
    console.log('3. Cancel');

    const choice = await askQuestion('Choose an option (1-3)', '1');

    if (choice === '3') {
      console.log('✗ Operation cancelled.');
      closeReadlineInterface();
      process.exit(0);
    }

    const printOnly = choice === '2';
    const clientName = `${serverName}Client`;

    const clientCode = await generateClientCode(
      pubkey,
      toolListResult,
      serverName,
      config.privateKey,
      config.relays
    );

    if (printOnly) {
      console.log('\nGenerated Client Code:');
      console.log('='.repeat(50));
      console.log(clientCode);
      console.log('='.repeat(50));
    } else {
      const outputPath = path.join(cwd, config.source, `${clientName}.ts`);
      await writeFileWithDir(outputPath, clientCode);

      // Add the client to the config if it's not already there
      if (!config.addedClients) {
        config.addedClients = [];
      }
      if (!config.addedClients.includes(pubkey)) {
        config.addedClients.push(pubkey);
      }
      await saveCnConfig(cwd, config);

      console.log(`✓ Generated client for ${serverName} at ${outputPath}`);
    }

    closeReadlineInterface();
    process.exit(0);
  } catch (error) {
    closeReadlineInterface();
    console.error(`✗ Error in connecting to server:`, error);
    process.exit(1);
  }
}
