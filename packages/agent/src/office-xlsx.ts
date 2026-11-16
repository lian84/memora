import ExcelJS from 'exceljs';
import type { SpreadsheetCell, SpreadsheetPreview, SpreadsheetSheet } from '@memora/shared';

const MAX_SHEETS = 5;
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 50;
const MAX_PREVIEW_ROWS = 200;
const MAX_PREVIEW_COLUMNS = 30;

interface MarkdownTable {
  heading: string;
  header: string[];
  rows: string[][];
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => stripInlineMarkdown(cell));
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTables(markdown: string): MarkdownTable[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const tables: MarkdownTable[] = [];
  let heading = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const headingMatch = line.trim().match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      heading = stripInlineMarkdown(headingMatch[1]!);
      continue;
    }
    if (!line.trim().startsWith('|') || !isTableSeparator(lines[index + 1] ?? '')) continue;
    const header = splitTableRow(line);
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
      rows.push(splitTableRow(lines[index]!));
      index++;
    }
    index--;
    if (header.length > 0) tables.push({ heading, header, rows });
  }
  return tables;
}

function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return cleaned || fallback;
}

function uniqueSheetName(name: string, used: Set<string>): string {
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffixText = ` ${suffix++}`;
    candidate = `${name.slice(0, Math.max(1, 31 - suffixText.length))}${suffixText}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function fallbackTable(markdown: string): MarkdownTable {
  const lines = markdown.split('\n').map(line => stripInlineMarkdown(line)).filter(Boolean);
  return {
    heading: 'Dati',
    header: ['Contenuto'],
    rows: (lines.length > 0 ? lines : ['Documento vuoto']).map(line => [line]),
  };
}

function setCellFormatting(cell: ExcelJS.Cell, header: boolean): void {
  if (header) {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  }
  cell.alignment = { vertical: 'middle', wrapText: true };
}

/** Converte le tabelle Markdown in un workbook Excel. */
export async function renderXlsxFromMarkdown(markdown: string): Promise<Buffer> {
  const tables = parseTables(markdown);
  const source = tables.length > 0 ? tables.slice(0, MAX_SHEETS) : [fallbackTable(markdown)];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Memora';
  workbook.created = new Date();
  const usedNames = new Set<string>();

  for (const [tableIndex, table] of source.entries()) {
    const sheet = workbook.addWorksheet(uniqueSheetName(sanitizeSheetName(table.heading, `Foglio ${tableIndex + 1}`), usedNames));
    const columnCount = Math.min(Math.max(table.header.length, ...table.rows.map(row => row.length), 1), MAX_COLUMNS);
    const headerRow = sheet.addRow(table.header.slice(0, columnCount));
    headerRow.eachCell(cell => setCellFormatting(cell, true));
    for (const row of table.rows.slice(0, MAX_ROWS - 1)) {
      const values = Array.from({ length: columnCount }, (_, index) => row[index] ?? '');
      sheet.addRow(values);
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: columnCount } };
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex++) {
      let width = 12;
      for (let rowIndex = 1; rowIndex <= Math.min(sheet.rowCount, 100); rowIndex++) {
        width = Math.max(width, String(sheet.getRow(rowIndex).getCell(columnIndex).value ?? '').length + 2);
      }
      sheet.getColumn(columnIndex).width = Math.min(width, 48);
    }
  }

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function colorToHex(color: ExcelJS.Color | undefined): string | undefined {
  if (!color?.argb || color.argb.length < 6) return undefined;
  return `#${color.argb.slice(-6)}`;
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleString('it-IT');
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map(item => item.text).join('');
    if ('formula' in value) {
      const result = (value as { result?: unknown }).result;
      return result === null || result === undefined ? `=${(value as { formula: string }).formula}` : String(result);
    }
    if ('text' in value) return String(value.text);
    if ('hyperlink' in value) return String((value as { text?: unknown }).text ?? (value as { hyperlink?: unknown }).hyperlink ?? '');
  }
  return String(value);
}

function cellModel(cell: ExcelJS.Cell): SpreadsheetCell {
  const font = cell.font;
  const fill = cell.fill;
  const model: SpreadsheetCell = { value: cellText(cell) };
  if (font?.bold) model.bold = true;
  if (font?.italic) model.italic = true;
  const color = colorToHex(font?.color as ExcelJS.Color | undefined);
  if (color) model.color = color;
  if (fill && typeof fill === 'object' && 'type' in fill && fill.type === 'pattern' && fill.pattern === 'solid') {
    const background = colorToHex(fill.fgColor as ExcelJS.Color | undefined);
    if (background) model.background = background;
  }
  if (cell.alignment?.horizontal === 'center' || cell.alignment?.horizontal === 'right' || cell.alignment?.horizontal === 'left') {
    model.align = cell.alignment.horizontal;
  }
  if (cell.numFmt) model.numberFormat = cell.numFmt;
  return model;
}

/** Legge un workbook per la preview UI, con limiti espliciti. */
export async function readXlsxPreview(buffer: Buffer): Promise<SpreadsheetPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets: SpreadsheetSheet[] = [];
  let truncated = workbook.worksheets.length > MAX_SHEETS;
  for (const worksheet of workbook.worksheets.slice(0, MAX_SHEETS)) {
    const rowCount = Math.min(worksheet.actualRowCount || worksheet.rowCount, MAX_PREVIEW_ROWS);
    const columnCount = Math.min(worksheet.actualColumnCount || worksheet.columnCount, MAX_PREVIEW_COLUMNS);
    if ((worksheet.actualRowCount || worksheet.rowCount) > MAX_PREVIEW_ROWS || (worksheet.actualColumnCount || worksheet.columnCount) > MAX_PREVIEW_COLUMNS) truncated = true;
    const rows: SpreadsheetCell[][] = [];
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex++) {
      const row: SpreadsheetCell[] = [];
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex++) {
        row.push(cellModel(worksheet.getRow(rowIndex).getCell(columnIndex)));
      }
      rows.push(row);
    }
    const columns = Array.from({ length: columnCount }, (_, index) => {
      const width = worksheet.getColumn(index + 1).width;
      return width ? Math.round(width * 8 + 16) : 96;
    });
    const merges = Array.isArray((worksheet.model as { merges?: string[] }).merges)
      ? (worksheet.model as { merges?: string[] }).merges
      : [];
    sheets.push({ name: worksheet.name, rows, columns, merges });
  }
  return { kind: 'xlsx', sheets, ...(truncated ? { truncated: true } : {}) };
}
