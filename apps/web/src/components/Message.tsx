import { useEffect, useRef, useState } from 'react';
import type { ChatAttachment } from '@memora/shared';
import { chatAttachmentUrl } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';

interface MessageProps {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  streaming?: boolean;
  attachments?: ChatAttachment[];
  sessionId?: string | null;
  onExportPdf?: () => void;
  onRegenerate?: () => void;
  onSaveMemory?: () => void;
  onEditText?: (text: string) => Promise<void> | void;
  exportingPdf?: boolean;
  hideHtmlCode?: boolean;
}

const roleLabel: Record<string, string> = {
  system: 'System',
  user: 'Tu',
  assistant: 'Memo',
};

export function Message({ role, content, timestamp, streaming = false, attachments = [], sessionId, onExportPdf, onSaveMemory, onRegenerate, onEditText, exportingPdf = false, hideHtmlCode = false }: MessageProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(content);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing || !editRef.current) return;
    const element = editRef.current;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, window.innerHeight * 0.6)}px`;
  }, [editing, editText]);

  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const htmlBlock = hideHtmlCode && role === 'assistant' ? content.match(/```(?:html|htm)?\s*\n([\s\S]*?)```/i) : null;
  const visibleContent = htmlBlock ? content.replace(htmlBlock[0], '').trim() : content;
  const copyText = role === 'user' ? content.replace(/<[^>]*>/g, '') : htmlBlock ? visibleContent : content;
  const time = new Date(timestamp).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyText);
      } else {
        const area = document.createElement('textarea');
        area.value = copyText;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setEditError('Copia non disponibile: seleziona il testo manualmente.');
    }
  };

  const startEdit = () => {
    setEditText(content);
    setEditError(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!onEditText || !editText.trim() || editBusy) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await onEditText(editText.trim());
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <article className={`message message-${role}`}>
      <header className="message-header">
        <span className="message-author">{roleLabel[role]}</span>
        <time className="message-time" dateTime={new Date(timestamp).toISOString()}>{time}</time>
        {streaming && <span className="message-streaming">in corso</span>}
        <span className="message-actions">
          {role === 'user' && onEditText && (
            <button type="button" className="message-action" onClick={startEdit} title="Modifica domanda" aria-label="Modifica domanda">✎</button>
          )}
          <button type="button" className="message-action" onClick={() => void copy()} title={copied ? 'Copiato' : role === 'user' ? 'Copia domanda (testo)' : 'Copia risposta (Markdown)'} aria-label={copied ? 'Copiato' : role === 'user' ? 'Copia domanda in testo' : 'Copia risposta in Markdown'}>{copied ? '✓' : '⧉'}</button>
          {role === 'assistant' && onSaveMemory && (
            <button type="button" className="message-action is-text" onClick={onSaveMemory} title="Salva questa risposta come memoria" aria-label="Salva risposta come memoria">Memoria</button>
          )}
          {role === 'assistant' && onRegenerate && (
            <button type="button" className="message-action is-text" onClick={onRegenerate} title="Chiedi di riformulare" aria-label="Riformula risposta">Riformula</button>
          )}
          {role === 'assistant' && onExportPdf && (
            <button type="button" className="message-action is-text" onClick={onExportPdf} disabled={exportingPdf || !content.trim()} title="Esporta questa risposta in PDF">
              {exportingPdf ? 'PDF…' : 'PDF'}
            </button>
          )}
        </span>
      </header>

      {editing ? (
        <div className="message-edit">
          <textarea ref={editRef} value={editText} onChange={event => setEditText(event.target.value)} rows={8} disabled={editBusy} autoFocus />
          {editError && <div className="message-edit-error" role="alert">{editError}</div>}
          <div className="message-edit-actions">
            <button type="button" onClick={() => setEditing(false)} disabled={editBusy}>Annulla</button>
            <button type="button" className="is-primary" onClick={() => void saveEdit()} disabled={editBusy || !editText.trim()}>{editBusy ? 'Salvo…' : 'Salva e rigenera'}</button>
          </div>
        </div>
      ) : (
        <>
          {attachments.length > 0 && (
            <div className="message-attachments">
              {attachments.map(attachment => {
                const href = sessionId ? chatAttachmentUrl(sessionId, attachment.id) : undefined;
                return (
                  <a key={attachment.id} className={`message-attachment is-${attachment.kind}`} href={href} target="_blank" rel="noreferrer" title={href ? 'Apri allegato' : attachment.filename}>
                    <span className="message-attachment-kind">{attachment.filename.split('.').pop()?.toUpperCase() ?? 'FILE'}</span>
                    <span className="message-attachment-name">{attachment.filename}</span>
                    <span className="message-attachment-size">{formatSize(attachment.size)}</span>
                    {attachment.projectPath && <span className="message-attachment-project">progetto</span>}
                  </a>
                );
              })}
            </div>
          )}
          <div
            className="message-content"
            aria-live={streaming ? 'polite' : undefined}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming && !visibleContent ? 'Memo sta rispondendo…' : visibleContent) }}
          />
          {htmlBlock && <div className="message-html-artifact-note">Documento generato · PDF disponibile nella scheda Artefatti.</div>}
        </>
      )}
    </article>
  );
}
