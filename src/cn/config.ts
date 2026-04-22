/**
 * Configuration for the cn (code generation) sub-command.
 * Manages .cvmi-cn.json project configuration files.
 */
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export interface CnConfig {
  /** Output directory for generated clients (relative to project root) */
  source: string;
  /** Relay URLs for connecting to CVM servers */
  relays: string[];
  /** Private key for authenticating with CVM servers */
  privateKey?: string;
  /** Array of public keys of added clients */
  addedClients?: string[];
}

export const CN_CONFIG_FILENAME = '.cvmi-cn.json';

export const DEFAULT_CN_CONFIG: CnConfig = {
  source: 'src/ctxcn',
  relays: ['wss://relay.contextvm.org'],
  addedClients: [],
};

/**
 * Load cn configuration from a .cvmi-cn.json file in the given directory.
 * Falls back to environment variable for private key.
 */
export async function loadCnConfig(cwd: string): Promise<CnConfig> {
  const configPath = join(cwd, CN_CONFIG_FILENAME);
  try {
    const configContent = await readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(configContent);
    const config = { ...DEFAULT_CN_CONFIG, ...userConfig };

    if (typeof config.source !== 'string' || !config.source) {
      config.source = DEFAULT_CN_CONFIG.source;
    }

    // Ensure addedClients is always an array
    if (!config.addedClients || !Array.isArray(config.addedClients)) {
      config.addedClients = [];
    }

    // Resolve private key from environment if not in config
    if (!config.privateKey && process.env.CVMI_CN_PRIVATE_KEY) {
      config.privateKey = process.env.CVMI_CN_PRIVATE_KEY;
    }

    return config;
  } catch {
    // Return defaults with env-based private key if available
    return {
      ...DEFAULT_CN_CONFIG,
      privateKey: process.env.CVMI_CN_PRIVATE_KEY,
    };
  }
}

/**
 * Save cn configuration to a .cvmi-cn.json file in the given directory.
 */
export async function saveCnConfig(cwd: string, config: CnConfig): Promise<void> {
  const configPath = join(cwd, CN_CONFIG_FILENAME);
  // Strip privateKey from persisted config — use env var instead
  const { privateKey: _, ...persistable } = config;
  await writeFile(configPath, JSON.stringify(persistable, null, 2) + '\n');
}
