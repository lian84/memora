import React, { useEffect, useRef, useState } from 'react';
import type { ChatAttachment } from '@memora/shared';

interface ComposerProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  /** Cambia quando la chat attiva cambia: riporta il focus sul campo. */
  focusKey?: string | null;
  attachments?: ChatAttachment[];
  onFilesSelected?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
  attachmentBusy?: boolean;
  attachmentError?: string | null;
}

export function Composer({ onSend, onAbort, disabled = false, isStreaming = false, focusKey = null, attachments = [], onFilesSelected, onRemoveAttachment, attachmentBusy = false, attachmentError = null }: ComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [focusKey]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const value = text.trim();
    if (!value || disabled || isStreaming) return;
    onSend(value);
    setText('');
    textareaRef.current?.focus();
  };

  const sendDisabled = disabled || isStreaming || attachmentBusy || !text.trim();
  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className="composer">
      {(attachments.length > 0 || attachmentError) && (
        <div className="composer-attachments">
          {attachments.map(attachment => (
            <span className="composer-attachment" key={attachment.id}>
              <span className={`attachment-kind is-${attachment.kind}`}>{attachment.filename.split('.').pop()?.toUpperCase() ?? 'FILE'}</span>
              <span className="composer-attachment-name" title={attachment.filename}>{attachment.filename}</span>
              <span className="composer-attachment-size">{formatSize(attachment.size)}</span>
              {attachment.projectPath && <span className="composer-attachment-project">progetto</span>}
              {onRemoveAttachment && (
                <button type="button" aria-label={`Rimuovi ${attachment.filename}`} onClick={() => onRemoveAttachment(attachment.id)}>×</button>
              )}
            </span>
          ))}
          {attachmentBusy && <span className="composer-attachment is-uploading">Caricamento…</span>}
          {attachmentError && <span className="composer-attachment-error" role="alert">{attachmentError}</span>}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="composer-file-input"
        multiple
        accept=".md,.txt,.pdf,.docx,.html,.htm,.csv,.json,image/*"
        onChange={(event) => {
          if (event.target.files?.length) onFilesSelected?.(event.target.files);
          event.target.value = '';
        }}
      />
      {onFilesSelected && (
        <button
          type="button"
          className="attach-button"
          aria-label="Aggiungi allegati"
          title="Aggiungi allegati (.md, .txt, .pdf, .docx, .html, immagini)"
          disabled={disabled || isStreaming || attachmentBusy}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21.4 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
          </svg>
        </button>
      )}
      <textarea
        ref={textareaRef}
        className="composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Scrivi un messaggio… (Invio per inviare, Shift+Invio per andare a capo)"
        disabled={disabled || isStreaming || attachmentBusy}
        rows={1}
      />
      <div className="composer-actions">
        {isStreaming && (
          <button type="button" className="stop-button" onClick={onAbort}>
            Stop
          </button>
        )}
        <button type="button" className="send-button" onClick={handleSend} disabled={sendDisabled}>
          {isStreaming ? 'Rispondo…' : 'Invia'}
        </button>
      </div>
    </div>
  );
}
