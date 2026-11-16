import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

interface DocxOptions {
  title?: string;
}

function inlineRuns(text: string, bold = false): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean);
  return parts.map(part => {
    if (part.startsWith('**') && part.endsWith('**')) return new TextRun({ text: part.slice(2, -2), bold: true });
    if (part.startsWith('*') && part.endsWith('*')) return new TextRun({ text: part.slice(1, -1), italics: true });
    if (part.startsWith('`') && part.endsWith('`')) return new TextRun({ text: part.slice(1, -1), font: 'Courier New', shading: { fill: 'F1F5F9' } });
    return new TextRun({ text: part, bold });
  });
}

function cleanCell(value: string): string {
  return value.trim().replace(/^\|/, '').replace(/\|$/, '').trim();
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanCell);
}

function headingLevel(marks: string): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (marks.length) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    case 4: return HeadingLevel.HEADING_4;
    case 5: return HeadingLevel.HEADING_5;
    default: return HeadingLevel.HEADING_6;
  }
}

function tableFromLines(lines: string[]): Table {
  const rows = lines.map(splitTableRow);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map(cell => new TableCell({
          children: [new Paragraph({ children: inlineRuns(cell, true) })],
        })),
      }),
      ...body.map(row => new TableRow({
        children: row.map(cell => new TableCell({ children: [new Paragraph({ children: inlineRuns(cell) })] })),
      })),
    ],
  });
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/** Converte il Markdown finale in un documento Word leggibile. */
export async function renderDocxFromMarkdown(markdown: string, options: DocxOptions = {}): Promise<Buffer> {
  const normalized = markdown.replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  const children: Array<Paragraph | Table> = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^```/.test(trimmed)) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test((lines[index] ?? '').trim())) {
        code.push(lines[index] ?? '');
        index++;
      }
      children.push(new Paragraph({
        shading: { fill: 'F8FAFC' },
        spacing: { before: 120, after: 120 },
        children: code.length > 0
          ? code.map((codeLine, codeIndex) => new TextRun({ text: codeLine, font: 'Courier New', size: 20, break: codeIndex > 0 ? 1 : 0 }))
          : [new TextRun({ text: '', font: 'Courier New', size: 20 })],
      }));
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      children.push(new Paragraph({
        heading: headingLevel(heading[1]!),
        children: inlineRuns(heading[2]!),
      }));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: inlineRuns(line.replace(/^\s*[-*+]\s+/, '')),
      }));
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: inlineRuns(line.replace(/^\s*\d+[.)]\s+/, '')),
      }));
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      children.push(new Paragraph({
        indent: { left: 360 },
        children: inlineRuns(line.replace(/^\s*>\s?/, '')),
      }));
      continue;
    }

    if (trimmed.startsWith('|') && isTableSeparator(lines[index + 1] ?? '')) {
      const tableLines = [line];
      index += 2;
      while (index < lines.length && /^\s*\|/.test(lines[index] ?? '')) {
        tableLines.push(lines[index]!);
        index++;
      }
      index--;
      children.push(tableFromLines(tableLines));
      continue;
    }

    const paragraphLines = [trimmed];
    while (index + 1 < lines.length) {
      const next = (lines[index + 1] ?? '').trim();
      if (!next || /^(#{1,6})\s+/.test(next) || /^\s*[-*+]\s+/.test(lines[index + 1] ?? '') || /^\s*\d+[.)]\s+/.test(lines[index + 1] ?? '') || /^```/.test(next) || /^\s*\|/.test(next) || /^\s*>\s?/.test(lines[index + 1] ?? '')) break;
      paragraphLines.push(next);
      index++;
    }
    children.push(new Paragraph({ children: inlineRuns(paragraphLines.join(' ')) }));
  }

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Documento vuoto.' })] }));
  }

  const document = new Document({
    ...(options.title ? { title: options.title } : {}),
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(document);
}
