import { useState } from 'react';
import type { SpreadsheetCell, SpreadsheetPreview } from '@memora/shared';

interface SpreadsheetViewProps {
  data: SpreadsheetPreview;
  title: string;
}

interface MergeRange {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

function columnNumber(value: string): number {
  return value.split('').reduce((total, char) => total * 26 + (char.charCodeAt(0) - 64), 0);
}

function parseRange(value: string): MergeRange | null {
  const match = value.replaceAll('$', '').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    startColumn: columnNumber(match[1]!.toUpperCase()),
    startRow: Number(match[2]),
    endColumn: columnNumber(match[3]!.toUpperCase()),
    endRow: Number(match[4]),
  };
}

function cellStyle(cell: SpreadsheetCell): React.CSSProperties {
  return {
    fontWeight: cell.bold ? 700 : undefined,
    fontStyle: cell.italic ? 'italic' : undefined,
    textAlign: cell.align,
    backgroundColor: cell.background,
    color: cell.color,
  };
}

export function SpreadsheetView({ data, title }: SpreadsheetViewProps) {
  const [activeSheet, setActiveSheet] = useState(0);
  if (!data || data.sheets.length === 0) return <div className="project-file-preview-empty">Nessun foglio disponibile.</div>;

  const sheet = data.sheets[Math.min(activeSheet, data.sheets.length - 1)]!;
  const merges = (sheet.merges ?? []).map(parseRange).filter((range): range is MergeRange => Boolean(range));
  const mergeAtStart = new Map<string, MergeRange>();
  const covered = new Set<string>();
  for (const range of merges) {
    mergeAtStart.set(`${range.startRow}:${range.startColumn}`, range);
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let column = range.startColumn; column <= range.endColumn; column++) {
        if (row !== range.startRow || column !== range.startColumn) covered.add(`${row}:${column}`);
      }
    }
  }

  return (
    <div className="spreadsheet-preview">
      <div className="spreadsheet-preview-head">
        <span>{title}</span>
        <span className="spreadsheet-preview-meta">{data.sheets.length} fogli{data.truncated ? ' · anteprima limitata' : ''}</span>
      </div>
      {data.sheets.length > 1 && (
        <div className="spreadsheet-tabs" role="tablist" aria-label="Fogli Excel">
          {data.sheets.map((item, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={index === activeSheet}
              className={index === activeSheet ? 'is-active' : ''}
              key={item.name}
              onClick={() => setActiveSheet(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <div className="spreadsheet-scroll">
        <table className="spreadsheet-table">
          <colgroup>
            {(sheet.columns ?? []).map((width, index) => <col key={index} style={{ width: `${width}px` }} />)}
          </colgroup>
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => {
                  const key = `${rowIndex + 1}:${columnIndex + 1}`;
                  if (covered.has(key)) return null;
                  const merge = mergeAtStart.get(key);
                  const Tag = rowIndex === 0 ? 'th' : 'td';
                  return (
                    <Tag
                      key={key}
                      style={cellStyle(cell)}
                      {...(merge ? { colSpan: Math.min(merge.endColumn, row.length) - merge.startColumn + 1, rowSpan: merge.endRow - merge.startRow + 1 } : {})}
                    >
                      {cell.value}
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
