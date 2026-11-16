import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ScanResult {
  relativePath: string;
  absolutePath: string;
  category: string;
  projectId?: string;
  content: string;
  modifiedAt: number;
  size: number;
  contentHash: string;
}

/** Categorie riconosciute per directory principale sotto MEMORA_DATA_DIR. */
const CATEGORY_MAP: Record<string, string> = {
  memory: 'memory',
  projects: 'projects',
  journal: 'journal',
  documents: 'documents',
};

/**
 * Scansiona ricorsivamente i file .md nelle directory della knowledge base.
 * Esclude session JSONL, segreti, .env, database, codice sorgente.
 * Protegge contro path traversal e symlink che escono dalla data directory.
 */
export function scanMarkdown(dataDir: string): ScanResult[] {
  const results: ScanResult[] = [];
  const dataDirResolved = path.resolve(dataDir);

  const scanDir = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Symlink che esce dalla data directory → salta
      if (entry.isSymbolicLink()) {
        try {
          const realPath = fs.realpathSync(fullPath);
          if (!realPath.startsWith(dataDirResolved + path.sep) && realPath !== dataDirResolved) {
            continue;
          }
        } catch {
          continue;
        }
      }

      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(dataDirResolved, fullPath);
        const category = detectCategory(relativePath);
        const projectId = category === 'projects' ? relativePath.split(path.sep)[1] : undefined;
        const isProjectSourceText = category === 'projects'
          && entry.name.endsWith('.txt')
          && relativePath.split(path.sep)[2] === 'sources';

        // Markdown ovunque nelle root; testo semplice solo nelle fonti progetto.
        if (!entry.name.endsWith('.md') && !isProjectSourceText) continue;
        if (!category) continue;

        try {
          const stat = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath, 'utf-8');
          const contentHash = crypto.createHash('sha256').update(content).digest('hex');

          results.push({
            relativePath,
            absolutePath: fullPath,
            category,
            projectId,
            content,
            modifiedAt: stat.mtimeMs,
            size: stat.size,
            contentHash,
          });
        } catch {
          // Salta file illeggibili
        }
      }
    }
  };

  scanDir(dataDirResolved);
  return results;
}

/**
 * Determina la categoria dal percorso relativo.
 * Ritorna undefined se il file è fuori dalle directory riconosciute.
 */
function detectCategory(relativePath: string): string | null {
  const firstSegment = relativePath.split(path.sep)[0];
  return CATEGORY_MAP[firstSegment] ?? null;
}

/**
 * Calcola l'hash SHA-256 di una stringa.
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
