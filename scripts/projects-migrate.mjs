import { memoraEnv } from './env.mjs';
// Migrazione non distruttiva dei progetti legacy a project.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectStore } from '../apps/server/dist/projects.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(repoRoot, memoraEnv('DATA_DIR') ?? './data');
const apply = process.argv.includes('--apply');
const store = new ProjectStore(dataDir, message => console.warn(message));
const result = await store.migrateLegacy(apply);
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', dataDir, ...result }, null, 2));
if (!apply && result.total > result.skipped) console.log('Esegui con --apply per creare project.json nei progetti legacy.');
