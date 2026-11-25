import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Legge la versione dal package.json della root del monorepo. */
export function readPackageVersion(moduleUrl: string = import.meta.url): string | undefined {
  try {
    const moduleDir = path.dirname(fileURLToPath(moduleUrl));
    const raw = fs.readFileSync(path.resolve(moduleDir, '../../../package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** MEMORA_VERSION esplicita, poi package.json, poi 0.0.0. */
export function resolveAppVersion(env: NodeJS.ProcessEnv = process.env, packageVersion?: string): string {
  const configured = env.MEMORA_VERSION?.trim();
  return configured || packageVersion || readPackageVersion() || '0.0.0';
}
