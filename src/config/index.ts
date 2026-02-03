/**
 * Configuration module for cvmi CLI.
 * Provides simplified JSON-based configuration with SDK types.
 */
export {
  loadConfig,
  loadConfigFromEnv,
  getConfigPaths,
  getServeConfig,
  getUseConfig,
  DEFAULT_RELAYS,
  DEFAULT_ENCRYPTION,
} from './loader.ts';

export type {
  ServeConfig,
  ServeJsonConfig,
  UseConfig,
  UseJsonConfig,
  CvmiConfig,
  ConfigPaths,
} from './types.ts';
