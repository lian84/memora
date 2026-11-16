import mammoth from 'mammoth';

const DOCX_PREVIEW_CSS = `body{font-family:Georgia,"Times New Roman",serif;line-height:1.6;color:#1f2937;max-width:760px;margin:32px auto;padding:0 24px}h1,h2,h3{line-height:1.25}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#f1f5f9}pre{overflow:auto;background:#f8fafc;padding:10px}code{font-family:ui-monospace,monospace;background:#f1f5f9;padding:1px 3px}`;

/** Converte un DOCX in HTML con una pagina leggibile e sicura. */
export async function renderDocxPreviewHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer });
  return `<style>${DOCX_PREVIEW_CSS}</style>${result.value}`;
}
