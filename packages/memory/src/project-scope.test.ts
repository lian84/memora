import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryService } from './index.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function write(root: string, relative: string, text: string) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `# Nota\n\n## Dati\n\n- ${text}\n`);
}

describe('project-scoped retrieval', () => {
  it('separa globale, progetto corrente e altri progetti', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-project-scope-'));
    dirs.push(dir);
    write(dir, 'memory/profile.md', 'Il database globale di riferimento è PostgreSQL.');
    write(dir, 'projects/orione/memory.md', 'Orione usa PostgreSQL per il database.');
    write(dir, 'projects/orione/sources/architettura.md', 'Il database di Orione usa PostgreSQL in produzione.');
    write(dir, 'projects/luna/memory.md', 'Luna usa MySQL per il database.');
    const service = new MemoryService(dir, { searchMode: 'lexical', diversity: 0 });
    try {
      await service.initialize();
      await service.reindex();
      const withGlobal = await service.searchScoped('database', { projectId: 'orione', includeGlobal: true, topK: 10 });
      const paths = withGlobal.map(result => result.relativePath);
      expect(paths).toContain('projects/orione/memory.md');
      expect(paths).toContain('memory/profile.md');
      expect(paths).not.toContain('projects/luna/memory.md');
      expect(withGlobal.find(result => result.relativePath === 'projects/orione/memory.md')?.projectId).toBe('orione');

      const projectOnly = await service.searchScoped('database', { projectId: 'orione', includeGlobal: false, topK: 10 });
      expect(projectOnly.map(result => result.relativePath).sort()).toEqual([
        'projects/orione/memory.md',
        'projects/orione/sources/architettura.md',
      ]);

      const memoryOnly = await service.searchScoped('database', { projectId: 'orione', includeGlobal: false, includeProjectSources: false, topK: 10 });
      expect(memoryOnly.map(result => result.relativePath)).toEqual(['projects/orione/memory.md']);

      const sourcesOnly = await service.searchScoped('database', { projectId: 'orione', includeGlobal: false, includeProjectMemory: false, topK: 10 });
      expect(sourcesOnly.map(result => result.relativePath)).toEqual(['projects/orione/sources/architettura.md']);
    } finally {
      await service.close();
    }
  });
});
