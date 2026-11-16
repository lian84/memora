import { memoraEnv } from './env.mjs';
// Reproducible synthetic Second Brain; no personal content or external inference.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { MemoryService, TransformersEmbeddingService, DEFAULT_EMBEDDING_MODEL } from '../packages/memory/dist/index.js';

const items = [
 ['vega','Il progetto Vega utilizza il colore identificativo turchese.', ['Qual è il colore di Vega?','Quale tonalità abbiamo associato a Vega?','Che scelta cromatica avevamo fatto per Vega?']],
 ['tailscale','Per i servizi domestici preferisco Tailscale e non voglio esporre porte pubblicamente su Internet.', ['Come voglio raggiungere i miei server quando sono fuori casa?']],
 ['orione','Per il progetto Orione abbiamo deciso di usare PostgreSQL.', ['Quale database avevamo scelto per Orione?']],
 ['atlas','Il codice interno di Atlas è ZX-7319.', ['ZX-7319']],
 ['docker','Il deployment dei servizi usa Docker Compose su Debian.', ['Come vengono distribuiti i servizi sul server Debian?']],
 ['backup','I backup del database vengono eseguiti ogni notte e conservati per trenta giorni.', ['Quanto tempo manteniamo le copie di sicurezza del database?']],
 ['api','La API di Mercurio richiede un token Bearer per autenticare le richieste.', ['Come autenticare le chiamate API di Mercurio?']],
 ['memory','La memoria personale è conservata in file Markdown e SQLite è solo un indice.', ['Qual è la fonte autorevole per la memoria?']],
 ['meeting','La riunione del team è fissata il martedì alle dieci.', ['Quando si incontra la squadra?']],
 ['luna','Il progetto Luna usa il colore blu e il database MySQL.', ['Quale database usa Luna?']],
 ['sole','Il progetto Sole usa il colore rosso e Redis per la cache.', ['Qual è la tinta identificativa del progetto Sole?']],
 ['monitoring','Prometheus raccoglie le metriche e Grafana mostra i dashboard.', ['Con cosa visualizziamo i grafici delle metriche?']],
 ['server','Il server di sviluppo si chiama Castore e gira su Debian.', ['Come si chiama la macchina di sviluppo?']],
 ['prod','Il server di produzione Polluce gira su Ubuntu.', ['Quale sistema operativo usa Polluce?']],
 ['email','Le notifiche importanti arrivano per email, quelle ordinarie in chat.', ['Dove ricevo gli avvisi urgenti?']],
 ['python','Il progetto Selene usa Python 3.12 per le elaborazioni.', ['Quale versione Python usa Selene?']],
 ['node','Il servizio web usa Node.js 24 e TypeScript strict.', ['Quale versione di Node usa il servizio web?']],
 ['garden','Le piante del terrazzo vanno annaffiate ogni sabato.', ['Quando devo dare acqua ai vasi sul balcone?']],
 ['dns','Il dominio interno lab.example.test viene risolto dal DNS locale.', ['Qual è il dominio della rete interna?']],
 ['music','Durante il lavoro preferisco musica strumentale senza parole.', ['Che musica ascolto mentre lavoro?']],
 ['coffee','Al mattino preferisco caffè senza zucchero.', ['Come prendo il caffè la mattina?']],
 ['auth','Per gli account importanti uso autenticazione a due fattori.', ['Come proteggo gli accessi più importanti?']],
 ['printer','La stampante dell’ufficio è una LaserJet e usa il cassetto due.', ['Quale cassetto usa la stampante?']],
 ['code','Il dispositivo Boreale ha identificativo AB-9827.', ['AB-9827']],
 ['travel','Per andare a Milano preferisco il treno anziché guidare.', ['Come preferisco raggiungere Milano?']],
 ['storage','I documenti di archivio sono salvati su un disco esterno cifrato.', ['Dove conservo i documenti archiviati?']],
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-benchmark-'));
const models = path.resolve(memoraEnv('DATA_DIR') ?? './data', 'models');
fs.mkdirSync(path.join(dir, 'projects')); fs.symlinkSync(models, path.join(dir, 'models'), 'dir');
for (const [id, content] of items) fs.writeFileSync(path.join(dir, 'projects', `${id}.md`), `# ${id}\n\n${content}\n`);
const provider = new TransformersEmbeddingService(dir, { model: memoraEnv('EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL, dimensions: Number(memoraEnv('EMBEDDING_DIMENSIONS') ?? 1024) });
const service = new MemoryService(dir, { embeddings: provider, hybridSearchEnabled: true });
try {
  let start = performance.now(); await service.initialize(); const loadMs = performance.now() - start;
  if (!provider.isAvailable()) throw new Error('Local model unavailable; run embeddings:setup first');
  const rssMiB = process.memoryUsage().rss / 1048576;
  start = performance.now(); await service.reindex(); const indexMs = performance.now() - start;
  const stats = {};
  const vega = [];
  for (const mode of ['lexical', 'semantic', 'hybrid']) {
    const times = [], ranks = [];
    const search = mode === 'lexical' ? service.searchLexical.bind(service) : mode === 'semantic' ? service.searchSemantic.bind(service) : service.searchHybrid.bind(service);
    await search('warmup', { topK: 10 });
    for (const [id, , queries] of items) for (const query of queries) {
      start = performance.now(); const results = await search(query, { topK: 10, maxChars: 100000 }); times.push(performance.now() - start);
      const rank = results.findIndex(r => r.relativePath === `projects/${id}.md`) + 1; ranks.push(rank);
      if (id === 'vega') { let row = vega.find(r => r.query === query); if (!row) { row = { query }; vega.push(row); } row[mode] = rank || null; }
    }
    times.sort((a,b) => a-b);
    stats[mode] = { queries: ranks.length, recall1: ranks.filter(r => r > 0 && r <= 1).length / ranks.length, recall3: ranks.filter(r => r > 0 && r <= 3).length / ranks.length, recall5: ranks.filter(r => r > 0 && r <= 5).length / ranks.length, mrr: ranks.reduce((sum,r) => sum + (r ? 1/r : 0), 0) / ranks.length, meanMs: times.reduce((a,b) => a+b, 0)/times.length, p95Ms: times[Math.ceil(times.length*0.95)-1] };
  }
  console.log(JSON.stringify({ model: provider.getModelInfo(), loadMs, rssMiB, indexMs, stats, vega }, null, 2));
} finally { await service.close(); fs.rmSync(dir, { recursive: true, force: true }); }
