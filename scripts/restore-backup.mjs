#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function usage() {
  console.log(`Uso:
  node scripts/restore-backup.mjs --file /percorso/backup.mbackup --data-dir /percorso/data [--yes] [--force]

La password viene letta da MEMORA_BACKUP_PASSWORD oppure richiesta in modo nascosto.
Il servizio deve essere fermo. La data directory esistente viene rinominata in
<data-dir>.restore-backup-<timestamp> e non viene cancellata.`);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = arg('--file');
const dataDir = arg('--data-dir');
const assumeYes = process.argv.includes('--yes');
const force = process.argv.includes('--force');

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exit ${code}`)));
  });
}

async function tarList(archive) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tzf', archive], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(stdout.split('\n').filter(Boolean)) : reject(new Error(stderr.trim() || 'Archivio tar non valido')));
  });
}

function validateEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error(`Percorso non sicuro nell’archivio: ${entry}`);
    }
  }
}

async function readPassword() {
  if (process.env.MEMORA_BACKUP_PASSWORD) return process.env.MEMORA_BACKUP_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('MEMORA_BACKUP_PASSWORD non impostata e nessun terminale interattivo.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // readline non nasconde l'input: usiamo raw mode per non mostrare la password.
  rl.close();
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';
    stdout.write('Password del backup: ');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
    };
    const onData = (char) => {
      for (const character of char) {
        if (character === '\u0003') { cleanup(); reject(new Error('Operazione annullata.')); return; }
        if (character === '\r' || character === '\n') { cleanup(); resolve(value); return; }
        if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue; }
        value += character;
      }
    };
    stdin.on('data', onData);
  });
}

async function serviceActive() {
  return new Promise(resolve => {
    const child = spawn('systemctl', ['is-active', 'memora.service'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.once('error', () => resolve(false));
    child.once('close', () => resolve(stdout.trim() === 'active'));
  });
}

async function main() {
  if (!file || !dataDir) { usage(); process.exitCode = 1; return; }
  const archive = path.resolve(file);
  const target = path.resolve(dataDir);
  const base = path.basename(archive);
  const id = base.endsWith('.mbackup') ? base.slice(0, -'.mbackup'.length) : base;
  const manifestPath = path.join(path.dirname(archive), `${id}.manifest.json`);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error(`Manifest non trovato o non leggibile: ${manifestPath}`);
  }
  if (manifest.version !== 1 || !manifest.record || manifest.record.id !== id || manifest.record.archiveName !== base) {
    throw new Error('Manifest del backup non valido o non corrispondente all’archivio.');
  }
  const actualHash = await sha256(archive);
  if (actualHash !== manifest.record.sha256) throw new Error('Checksum del backup non valido: archivio danneggiato o modificato.');
  if (!force && await serviceActive()) {
    throw new Error('memora.service è attivo. Fermalo prima di ripristinare, oppure usa --force con cautela.');
  }
  const password = await readPassword();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-restore-'));
  const decrypted = path.join(tempRoot, 'backup.tar.gz');
  const staging = path.join(tempRoot, 'data');
  try {
    const { decryptBackupFile } = await import(path.join(root, 'apps/server/dist/backup.js'));
    await decryptBackupFile(archive, decrypted, password);
    const entries = await tarList(decrypted);
    validateEntries(entries);
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    await run('tar', ['-xzf', decrypted, '-C', staging, '--no-same-owner']);
    const hasConfig = await fs.stat(path.join(staging, 'config')).then(() => true).catch(() => false);
    const hasMemory = await fs.stat(path.join(staging, 'memory')).then(() => true).catch(() => false);
    if (!hasConfig && !hasMemory) throw new Error('Il backup non contiene dati Memora riconoscibili.');

    if (!assumeYes) {
      if (!process.stdin.isTTY) throw new Error('Conferma richiesta: usa --yes in un contesto non interattivo.');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`Ripristinare ${archive} in ${target}? [y/N] `);
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) { console.log('Ripristino annullato.'); return; }
    }

    const exists = await fs.stat(target).then(() => true).catch(() => false);
    let safety;
    if (exists) {
      safety = `${target}.restore-backup-${Date.now()}`;
      await fs.rename(target, safety);
      console.log(`Data directory esistente spostata in ${safety}`);
    }
    try {
      await fs.mkdir(target, { recursive: true, mode: 0o700 });
      await run('tar', ['-xzf', decrypted, '-C', target, '--no-same-owner']);
      console.log(`Ripristino completato in ${target}`);
      console.log('Avvia Memora e verifica /api/health. Conserva la copia di sicurezza finché non hai verificato i dati.');
    } catch (error) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
      if (safety) await fs.rename(safety, target).catch(() => undefined);
      throw error;
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(`RESTORE FALLITO: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
