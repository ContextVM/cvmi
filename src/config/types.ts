/**
 * Simplified configuration types for cvmi CLI.
 * Uses SDK types directly where possible.
 */
import type { ServerInfo, EncryptionMode } from '@contextvm/sdk';

/**
 * Configuration for the serve command (gateway).
 * Maps to NostrServerTransportOptions but with simpler primitive types.
 */
export interface ServeConfig {
  /** Private key in hex format (auto-generated if not provided) */
  privateKey: string;
  /** Relay URLs (defaults to wss://relay.contextvm.org and wss://cvm.otherstuff.ai) */
  relays: string[];
  /** Whether this is a public server */
  public?: boolean;
  /** Allowed public keys for access control */
  allowedPubkeys?: string[];
  /** Encryption mode for communications */
  encryption?: EncryptionMode;
  /** Server info for announcements */
  serverInfo?: ServerInfo;
  /** MCP server command to execute */
  command?: string;
  /** MCP server command arguments */
  args?: string[];
  /** Optional remote MCP server URL (Streamable HTTP). Mutually exclusive with command/args. */
  url?: string;
}

/**
 * Configuration for serve command stored in JSON files.
 * Private keys should be stored in .env file as CVMI_SERVE_PRIVATE_KEY.
 */
export type ServeJsonConfig = Omit<ServeConfig, 'privateKey'>;

/**
 * Configuration for the use command (proxy).
 * Maps to NostrTransportOptions but with simpler primitive types.
 */
export interface UseConfig {
  /** Private key in hex format (auto-generated if not provided) */
  privateKey: string;
  /** Relay URLs (defaults to wss://relay.contextvm.org and wss://cvm.otherstuff.ai) */
  relays: string[];
  /** Server's public key to connect to */
  serverPubkey?: string;
  /** Encryption mode for communications */
  encryption?: EncryptionMode;
}

/**
 * Configuration for use command stored in JSON files.
 * Private keys should be stored in .env file as CVMI_USE_PRIVATE_KEY.
 */
export type UseJsonConfig = Omit<UseConfig, 'privateKey'>;

/**
 * Full cvmi configuration stored in JSON config files.
 * Note: Private keys are NOT stored in JSON files - use .env file instead.
 */
export interface CvmiConfig {
  /** Gateway/serve configuration */
  serve?: Partial<ServeJsonConfig>;
  /** Proxy/use configuration */
  use?: Partial<UseJsonConfig>;
}

/**
 * Configuration file paths.
 */
export interface ConfigPaths {
  /** Global config directory (~/.cvmi) */
  globalDir: string;
  /** Global config file path */
  globalConfig: string;
  /** Project config file path (./.cvmi.json) */
  projectConfig: string;
  /** Custom config file path (from --config flag) */
  customConfigPath?: string;
}
