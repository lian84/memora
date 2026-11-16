import { memoraEnv } from './env.mjs';
// Feedback advisory su approvazioni/rifiuti. Nessun contenuto e nessuna modifica.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(repoRoot, memoraEnv('DATA_DIR') ?? './data');
const file = path.join(dataDir, 'memory-inbox', 'candidates.jsonl');
const latest = new Map();
try {
  for (const line of (await fsp.readFile(file, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try {
      const candidate = JSON.parse(line);
      if (typeof candidate?.id === 'string' && typeof candidate?.status === 'string') latest.set(candidate.id, candidate);
    } catch {
      // ignora righe corrotte
    }
  }
} catch {
  // inbox assente
}
const values = [...latest.values()];
const approved = values.filter(candidate => candidate.status === 'approved');
const rejected = values.filter(candidate => candidate.status === 'rejected');
const reviewed = approved.length + rejected.length;
const approvalRate = reviewed === 0 ? null : approved.length / reviewed;
const average = (list, field) => {
  const numbers = list.map(candidate => candidate[field]).filter(value => typeof value === 'number' && Number.isFinite(value));
  return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
};
const currentConfidence = Number(memoraEnv('MEMORY_CURATOR_MIN_CONFIDENCE') ?? 0.75);
const currentSalience = Number(memoraEnv('MEMORY_CURATOR_MIN_SALIENCE') ?? 0.70);
let recommendation = 'Dati insufficienti: servono almeno 5 candidati revisionati.';
if (reviewed >= 5) {
  if (approvalRate !== null && approvalRate < 0.4) {
    recommendation = 'Tasso di approvazione basso: valuta di aumentare le soglie di circa 0.05 e osservare il prossimo ciclo.';
  } else if (approvalRate !== null && approvalRate > 0.85) {
    recommendation = 'Tasso di approvazione alto: valuta di abbassare le soglie di circa 0.05 per non perdere memorie utili.';
  } else {
    recommendation = 'Tasso di approvazione nella fascia operativa: mantieni le soglie attuali.';
  }
}
console.log(JSON.stringify({
  reviewed,
  approved: approved.length,
  rejected: rejected.length,
  approvalRate: approvalRate === null ? null : Number(approvalRate.toFixed(3)),
  averageApprovedConfidence: average(approved, 'confidenceScore'),
  averageRejectedConfidence: average(rejected, 'confidenceScore'),
  averageApprovedSalience: average(approved, 'salienceScore'),
  averageRejectedSalience: average(rejected, 'salienceScore'),
  thresholds: { minConfidence: currentConfidence, minSalience: currentSalience },
  recommendation,
  automaticChanges: false,
}, null, 2));
