#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';

const file = (() => { const i = process.argv.indexOf('--file'); return i >= 0 ? process.argv[i + 1] : undefined; })();
const dataDir = (() => { const i = process.argv.indexOf('--data-dir'); return i >= 0 ? process.argv[i + 1] : undefined; })();
const assumeYes = process.argv.includes('--yes');
const force = process.argv.includes('--force');

function usage() {
  console.log(`Uso:
  node scripts/import-export.mjs --file /percorso/memora-export.tar.gz --data-dir /percorso/data [--yes] [--force]

Importa un export leggibile in una data directory vuota. L'export non contiene
config, credenziali o segreti: dopo l'import bisogna completare il primo accesso
e riconfigurare provider e integrazioni.`);
}

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `tar exit ${code}`)));
  });
}

async function list(archive) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tzf', archive], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(stdout.split('\n').filter(Boolean)) : reject(new Error(stderr.trim() || 'Archivio non valido')));
  });
}

async function readInternalManifest(archive) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xOzf', archive, 'export-manifest.json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) { reject(new Error(stderr.trim() || 'Manifest interno non trovato')); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Manifest interno non valido')); }
    });
  });
}

async function main() {
  if (!file || !dataDir) { usage(); process.exitCode = 1; return; }
  const archive = path.resolve(file);
  const target = path.resolve(dataDir);
  const id = path.basename(archive).replace(/\.tar\.gz$/, '');
  const manifestPath = path.join(path.dirname(archive), `${id}.manifest.json`);
  const entries = await list(archive);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.version !== 1 || !manifest.record || manifest.record.id !== id) throw new Error('invalid');
  } catch {
    // L'archivio scaricato dalla UI è autosufficiente: il manifest è al suo interno.
    manifest = { version: 1, record: { id }, internal: await readInternalManifest(archive) };
  }
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error(`Percorso non sicuro: ${entry}`);
  }
  const existing = await fs.stat(target).then(() => true).catch(() => false);
  if (existing) {
    const names = await fs.readdir(target);
    const allowedEmpty = names.every(name => name === 'tools' || name === 'backups' || name === '.');
    if (names.length > 0 && !allowedEmpty && !force) {
      throw new Error(`La data directory non è vuota (${target}). Usa una directory pulita oppure --force con cautela.`);
    }
  }
  if (!assumeYes) {
    if (!process.stdin.isTTY) throw new Error('Conferma richiesta: usa --yes in un contesto non interattivo.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Importare ${archive} in ${target}? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) { console.log('Import annullato.'); return; }
  }
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  try {
    await run(['-xzf', archive, '-C', target, '--no-same-owner']);
    console.log(`Import completato in ${target}`);
    console.log('Non sono inclusi config, password, API key o token: completa il primo accesso e riconfigura le integrazioni.');
  } catch (error) {
    if (!existing) await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

main().catch(error => {
  console.error(`IMPORT FALLITO: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
