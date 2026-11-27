import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Serve la build React in produzione.
 *
 * Il plugin principale serve index.html e i file pubblici registrati all'avvio.
 * Gli asset Vite hanno nomi hashati che cambiano a ogni build: un secondo
 * plugin con wildcard sotto `/assets` li legge dal filesystem a ogni richiesta,
 * così una build non richiede un riavvio del servizio per i nuovi bundle.
 */
export async function registerWebStatic(app: FastifyInstance, webDistDir: string): Promise<void> {
  const indexFile = path.join(webDistDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    throw new Error(`Frontend production build non trovata in ${webDistDir}. Esegui pnpm build.`);
  }

  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: '/',
    wildcard: false,
    index: ['index.html'],
    cacheControl: false,
    setHeaders(response, filePath) {
      if (path.basename(filePath) === 'index.html') {
        response.header('Cache-Control', 'no-cache');
      } else {
        response.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });

  const assetsDir = path.join(webDistDir, 'assets');
  if (!fs.existsSync(assetsDir)) return;

  await app.register(fastifyStatic, {
    root: assetsDir,
    prefix: '/assets/',
    wildcard: true,
    decorateReply: false,
    cacheControl: false,
    setHeaders(response) {
      response.header('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });
}
