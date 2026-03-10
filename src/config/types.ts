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
  /** Private key resolved from CLI or environment (never from JSON config files) */
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
  /** Environment variables to pass to the spawned MCP server process */
  env?: Record<string, string>;
  /** Optional remote MCP server URL (Streamable HTTP). Mutually exclusive with command/args. */
  url?: string;
}

/**
 * Configuration for serve command stored in JSON files.
 * Private keys are excluded because JSON config files must not store them.
 */
export type ServeJsonConfig = Omit<ServeConfig, 'privateKey'>;

/**
 * Configuration for the use command (proxy).
 * Maps to NostrTransportOptions but with simpler primitive types.
 */
export interface UseConfig {
  /** Private key resolved from CLI or environment (never from JSON config files) */
  privateKey: string;
  /** Relay URLs (defaults to wss://relay.contextvm.org and wss://cvm.otherstuff.ai) */
  relays: string[];
  /** Server identity to connect to (hex, npub, or nprofile) */
  serverPubkey?: string;
  /** Encryption mode for communications */
  encryption?: EncryptionMode;
  /** Whether to use stateless transport mode */
  isStateless?: boolean;
}

/**
 * Configuration for use command stored in JSON files.
 * Private keys are excluded because JSON config files must not store them.
 */
export type UseJsonConfig = Omit<UseConfig, 'privateKey'>;

/**
 * Named remote server entry used by direct client commands.
 */
export interface ServerTargetConfig {
  /** Remote server identity stored in aliases, typically hex, npub, or nprofile */
  pubkey: string;
  /** Relay URLs to use for this server */
  relays?: string[];
  /** Encryption mode for communications */
  encryption?: EncryptionMode;
  /** Whether to use stateless transport mode */
  isStateless?: boolean;
  /** Optional display description */
  description?: string;
}

/**
 * Full cvmi configuration stored in JSON config files.
 * Note: Private keys are NOT stored in JSON files - use .env file instead.
 */
export interface CvmiConfig {
  /** Gateway/serve configuration */
  serve?: Partial<ServeConfig>;
  /** Proxy/use configuration */
  use?: Partial<UseConfig>;
  /** Named server aliases for direct calls */
  servers?: Record<string, ServerTargetConfig>;
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
