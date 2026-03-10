/**
 * Configuration module for cvmi CLI.
 * Provides simplified JSON-based configuration with SDK types.
 */
export {
  loadConfig,
  loadConfigFromEnv,
  loadCallPrivateKeyFromEnv,
  getConfigPaths,
  getServeConfig,
  getUseConfig,
  listServerAliases,
  upsertServerAlias,
  removeServerAlias,
  DEFAULT_RELAYS,
  DEFAULT_ENCRYPTION,
} from './loader.ts';

export type {
  ServeConfig,
  ServeJsonConfig,
  UseConfig,
  UseJsonConfig,
  ServerTargetConfig,
  CvmiConfig,
  ConfigPaths,
} from './types.ts';

export type { ConfigScope, ResolvedServerTargetConfig } from './loader.ts';
