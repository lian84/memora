import { AuthStore } from '../apps/server/dist/auth.js';
import { memoraEnv } from './env.mjs';

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Serve un terminale interattivo oppure MEMORA_NEW_PASSWORD.'));
      return;
    }
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';
    stdout.write(prompt);
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

async function main() {
  const dataDir = memoraEnv('DATA_DIR') ?? './data';
  const fromEnv = memoraEnv('NEW_PASSWORD');
  const password = fromEnv ?? await readHidden('Nuova password di Memora: ');
  if (!fromEnv) {
    const confirmation = await readHidden('Conferma password: ');
    if (password !== confirmation) throw new Error('Le password non coincidono.');
  }
  const store = new AuthStore(dataDir);
  await store.resetPassword(password);
  console.log(`Password di Memora aggiornata in ${dataDir}/config/auth.json`);
  console.log('Riavvia Memora per applicare la nuova password.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
