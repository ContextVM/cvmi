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
 * Full cvmi configuration stored in JSON config files.
 */
export interface CvmiConfig {
  /** Gateway/serve configuration */
  serve?: Partial<ServeConfig>;
  /** Proxy/use configuration */
  use?: Partial<UseConfig>;
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
