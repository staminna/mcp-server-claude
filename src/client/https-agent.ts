// HTTPS agent construction for Directus connections that need a custom CA,
// a client certificate, or a PFX bundle.
//
// Each of ca / cert / key / pfx may be given either as a filesystem path or as
// the PEM/DER content itself; a path is detected with fs.existsSync.

import https from 'https';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import { DirectusConfig } from '../types/directus.js';

type HttpsConfig = NonNullable<DirectusConfig['https']>;

/** Read a path-or-content value, preferring the file when the path exists. */
function resolveMaterial(
  value: string | Buffer | Array<string | Buffer>,
  label: string
): string | Buffer | Array<string | Buffer> {
  if (typeof value === 'string' && fs.existsSync(value)) {
    logger.info(`Loaded ${label} from file`, { path: value });
    return fs.readFileSync(value);
  }
  logger.info(`Using provided ${label} content`);
  return value;
}

/**
 * Build an https.Agent from the DIRECTUS_HTTPS_* configuration, or null when
 * no certificate configuration is present.
 */
export function createHttpsAgent(config?: HttpsConfig): https.Agent | null {
  if (!config) return null;

  const options: https.AgentOptions = {};

  if (config.ca) options.ca = resolveMaterial(config.ca, 'CA certificate') as https.AgentOptions['ca'];
  if (config.cert) options.cert = resolveMaterial(config.cert, 'client certificate') as https.AgentOptions['cert'];
  if (config.key) options.key = resolveMaterial(config.key, 'private key') as https.AgentOptions['key'];
  if (config.pfx) options.pfx = resolveMaterial(config.pfx, 'PFX certificate') as https.AgentOptions['pfx'];

  if (config.passphrase) options.passphrase = config.passphrase;
  if (config.rejectUnauthorized !== undefined) options.rejectUnauthorized = config.rejectUnauthorized;
  if (config.servername) options.servername = config.servername;

  logger.info('Created HTTPS agent with custom certificate configuration');
  return new https.Agent(options);
}
