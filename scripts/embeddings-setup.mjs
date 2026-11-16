import { memoraEnv } from './env.mjs';
import { spawnSync } from 'node:child_process';
import { DEFAULT_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL, TransformersEmbeddingService } from '../packages/memory/dist/index.js';

const dataDir = memoraEnv('DATA_DIR') ?? './data';
const info = {
  model: memoraEnv('EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL,
  dimensions: Number(memoraEnv('EMBEDDING_DIMENSIONS') ?? DEFAULT_EMBEDDING_DIMENSIONS),
};
const verify = process.argv.includes('--verify-offline');
const service = new TransformersEmbeddingService(dataDir, info, !verify);
try {
  await service.initialize();
  const vector = await service.embed('Memora embedding setup');
  console.log(JSON.stringify({ ...info, dimensions: vector.length, cache: `${dataDir}/models`, offline: verify }));
} finally {
  await service.close();
}
if (!verify) {
  const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--verify-offline'], { stdio: 'inherit', env: process.env });
  if (child.status !== 0) process.exit(child.status ?? 1);
}
