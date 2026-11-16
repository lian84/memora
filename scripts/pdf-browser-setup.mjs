#!/usr/bin/env node
import { memoraEnv } from './env.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = path.resolve(memoraEnv('DATA_DIR') ?? './data');
const target = path.join(dataDir, 'browser-libs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-pdf-libs-'));

try {
  if (process.platform !== 'linux') {
    throw new Error('Questo setup è previsto per Linux/Debian.');
  }
  console.log(`Scarico librerie browser in ${target}`);
  execFileSync('apt-get', ['download', 'libnspr4', 'libnss3'], { cwd: temp, stdio: 'inherit' });
  fs.mkdirSync(target, { recursive: true });
  const packages = fs.readdirSync(temp).filter(name => name.endsWith('.deb'));
  if (packages.length < 2) throw new Error('Pacchetti libnspr4/libnss3 non trovati.');
  for (const name of packages) {
    execFileSync('dpkg-deb', ['-x', path.join(temp, name), target], { stdio: 'inherit' });
  }
  console.log('Librerie installate. Riavvia Memora per usarle.');
  console.log('Verifica: LD_LIBRARY_PATH nel log del renderer.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
