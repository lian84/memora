import { describe, expect, it } from 'vitest';
import { readXlsxPreview, renderXlsxFromMarkdown } from './office-xlsx.js';

describe('XLSX generation', () => {
  it('crea un foglio per tabella con nome dal titolo', async () => {
    const buffer = await renderXlsxFromMarkdown('# Budget\n\n| Voce | Importo |\n| --- | --- |\n| Hosting | 20 |\n| Dominio | 12 |\n\n## Team\n\n| Ruolo | Persona |\n| --- | --- |\n| Dev | Ada |\n');
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const preview = await readXlsxPreview(buffer);
    expect(preview.sheets.map(sheet => sheet.name)).toEqual(['Budget', 'Team']);
    expect(preview.sheets[0]?.rows[0]?.map(cell => cell.value)).toEqual(['Voce', 'Importo']);
    expect(preview.sheets[0]?.rows[1]?.map(cell => cell.value)).toEqual(['Hosting', '20']);
    expect(preview.sheets[0]?.rows[0]?.[0]?.bold).toBe(true);
  });

  it('usa un foglio di fallback senza tabelle', async () => {
    const buffer = await renderXlsxFromMarkdown('Solo una nota.');
    const preview = await readXlsxPreview(buffer);
    expect(preview.sheets[0]?.name).toBe('Dati');
    expect(preview.sheets[0]?.rows[1]?.[0]?.value).toBe('Solo una nota.');
  });

  it('rifiuta un buffer non xlsx', async () => {
    await expect(readXlsxPreview(Buffer.from('not an xlsx'))).rejects.toBeTruthy();
  });
});
