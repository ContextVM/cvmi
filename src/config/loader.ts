/**
 * Simplified configuration loader for cvmi CLI.
 * Uses JSON format and 3-source priority: CLI flags > JSON config > Environment variables.
 */
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { EncryptionMode } from '@contextvm/sdk';
import type { CvmiConfig, ConfigPaths, ServeConfig, UseConfig } from './types.js';

/** Default relay URLs */
export const DEFAULT_RELAYS = ['wss://relay.contextvm.org', 'wss://cvm.otherstuff.ai'];

/** Default encryption mode */
export const DEFAULT_ENCRYPTION = EncryptionMode.OPTIONAL;

/**
 * Get the base config directory using XDG rules (matching src/agents.ts).
 */
function getConfigHome(): string {
  const home = homedir();

  if (process.platform === 'win32') {
    return join(home, 'AppData', 'Roaming', 'cvmi');
  }

  // For cvmi serve/use config, use a dotfolder (separate from XDG and from .agents/ skill installs).
  return join(home, '.cvmi');
}

/**
 * Get configuration file paths based on OS and XDG conventions.
 */
export function getConfigPaths(customConfigPath?: string): ConfigPaths {
  const globalDir = getConfigHome();

  return {
    globalDir,
    globalConfig: join(globalDir, 'config.json'),
    projectConfig: join(process.cwd(), '.cvmi.json'),
    customConfigPath,
  };
}

/**
 * Load configuration from environment variables.
 */
export function loadConfigFromEnv(): Partial<CvmiConfig> {
  const config: Partial<CvmiConfig> = {};

  // Serve/gateway environment variables
  if (process.env.CVMI_GATEWAY_PRIVATE_KEY || process.env.CVMI_SERVE_PRIVATE_KEY) {
    config.serve = {
      privateKey: process.env.CVMI_GATEWAY_PRIVATE_KEY || process.env.CVMI_SERVE_PRIVATE_KEY,
    };
  }

  const serveRelays = process.env.CVMI_GATEWAY_RELAYS || process.env.CVMI_SERVE_RELAYS;
  if (serveRelays) {
    config.serve = config.serve || {};
    config.serve.relays = serveRelays.split(',').map((r) => r.trim());
  }

  if (process.env.CVMI_GATEWAY_PUBLIC || process.env.CVMI_SERVE_PUBLIC) {
    config.serve = config.serve || {};
    config.serve.public =
      (process.env.CVMI_GATEWAY_PUBLIC || process.env.CVMI_SERVE_PUBLIC) === 'true';
  }

  const serveEncryption = process.env.CVMI_GATEWAY_ENCRYPTION || process.env.CVMI_SERVE_ENCRYPTION;
  if (serveEncryption) {
    config.serve = config.serve || {};
    config.serve.encryption = parseEncryptionMode(serveEncryption, 'env var');
  }

  // Use/proxy environment variables
  if (process.env.CVMI_PROXY_PRIVATE_KEY || process.env.CVMI_USE_PRIVATE_KEY) {
    config.use = {
      privateKey: process.env.CVMI_PROXY_PRIVATE_KEY || process.env.CVMI_USE_PRIVATE_KEY,
    };
  }

  const useRelays = process.env.CVMI_PROXY_RELAYS || process.env.CVMI_USE_RELAYS;
  if (useRelays) {
    config.use = config.use || {};
    config.use.relays = useRelays.split(',').map((r) => r.trim());
  }

  if (process.env.CVMI_PROXY_SERVER_PUBKEY || process.env.CVMI_USE_SERVER_PUBKEY) {
    config.use = config.use || {};
    config.use.serverPubkey =
      process.env.CVMI_PROXY_SERVER_PUBKEY || process.env.CVMI_USE_SERVER_PUBKEY;
  }

  const useEncryption = process.env.CVMI_PROXY_ENCRYPTION || process.env.CVMI_USE_ENCRYPTION;
  if (useEncryption) {
    config.use = config.use || {};
    config.use.encryption = parseEncryptionMode(useEncryption, 'env var');
  }

  return config;
}

/**
 * Load configuration from a JSON file.
 */
async function loadConfigFromFile(filePath: string): Promise<Partial<CvmiConfig>> {
  try {
    await access(filePath);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as Partial<CvmiConfig>;
  } catch {
    return {};
  }
}

/**
 * Merge multiple config sources into one (later sources override earlier ones).
 */
function mergeConfigs<T>(...sources: (Partial<T> | undefined)[]): Partial<T> {
  const filtered = sources.filter((s): s is Partial<T> => s !== undefined);

  return filtered.reduce((acc, src) => {
    // Only override keys that are explicitly defined in the higher-priority source.
    // This keeps lower-priority values when a higher-priority partial omits a field.
    for (const [key, value] of Object.entries(src) as [keyof T, T[keyof T]][]) {
      if (value !== undefined) {
        acc[key] = value;
      }
    }
    return acc;
  }, {} as Partial<T>);
}

/**
 * Load full configuration with priority: CLI > Custom config > Project config > Global config > Environment.
 * If customConfigPath is provided, it takes precedence over project and global configs (but CLI flags still win).
 */
export async function loadConfig(
  cliFlags: Partial<CvmiConfig> = {},
  customConfigPath?: string
): Promise<CvmiConfig> {
  const paths = getConfigPaths(customConfigPath);

  // Load from all sources (lowest to highest priority)
  const envConfig = loadConfigFromEnv();
  const globalConfig = await loadConfigFromFile(paths.globalConfig);
  const projectConfig = await loadConfigFromFile(paths.projectConfig);
  const customConfig = customConfigPath ? await loadConfigFromFile(customConfigPath) : {};

  // Merge with priority: CLI > Custom > Project > Global > Environment
  return {
    serve: mergeConfigs(
      envConfig.serve,
      globalConfig.serve,
      projectConfig.serve,
      customConfig.serve,
      cliFlags.serve
    ),
    use: mergeConfigs(
      envConfig.use,
      globalConfig.use,
      projectConfig.use,
      customConfig.use,
      cliFlags.use
    ),
  };
}

/**
 * Get serve configuration with defaults applied.
 */
export function getServeConfig(
  config: Partial<ServeConfig>,
  cliFlags: Partial<ServeConfig> = {}
): ServeConfig {
  return {
    privateKey: cliFlags.privateKey ?? config.privateKey ?? '',
    relays: cliFlags.relays ?? config.relays ?? DEFAULT_RELAYS,
    public: cliFlags.public ?? config.public ?? false,
    allowedPubkeys: cliFlags.allowedPubkeys ?? config.allowedPubkeys,
    encryption: cliFlags.encryption ?? config.encryption ?? DEFAULT_ENCRYPTION,
    serverInfo: cliFlags.serverInfo ?? config.serverInfo,
    command: cliFlags.command ?? config.command,
    args: cliFlags.args ?? config.args,
  };
}

/**
 * Get use configuration with defaults applied.
 */
export function getUseConfig(
  config: Partial<UseConfig>,
  cliFlags: Partial<UseConfig> = {}
): UseConfig {
  return {
    privateKey: cliFlags.privateKey ?? config.privateKey ?? '',
    relays: cliFlags.relays ?? config.relays ?? DEFAULT_RELAYS,
    serverPubkey: cliFlags.serverPubkey ?? config.serverPubkey,
    encryption: cliFlags.encryption ?? config.encryption ?? DEFAULT_ENCRYPTION,
  };
}

/**
 * Parse encryption mode from string value.
 * Logs a warning for invalid values and falls back to OPTIONAL.
 */
export function parseEncryptionMode(
  value: string | undefined,
  context?: string
): EncryptionMode | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'required') return EncryptionMode.REQUIRED;
  if (normalized === 'disabled') return EncryptionMode.DISABLED;
  if (normalized === 'optional') return EncryptionMode.OPTIONAL;

  // Invalid value - warn and fall back to OPTIONAL
  const warnContext = context ? ` (${context})` : '';
  console.warn(
    `Warning: Invalid encryption value "${value}"${warnContext}. ` +
      `Must be one of: optional, required, disabled. Falling back to "optional".`
  );
  return EncryptionMode.OPTIONAL;
}
