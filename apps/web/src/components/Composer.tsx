import React, { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ChatAttachment, SessionAgentInfo } from '@memora/shared';
import { AppIcon } from './AppIcon';
import { useI18n } from '../i18n';

interface ComposerProps {
  onSend: (text: string) => void;
  onQueue?: (text: string) => void;
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
  webEnabled?: boolean;
  webAvailable?: boolean;
  onToggleWeb?: () => void;
  agent?: SessionAgentInfo | null;
  agentSaving?: boolean;
}

export function Composer({ onSend, onQueue, onAbort, disabled = false, isStreaming = false, focusKey = null, attachments = [], onFilesSelected, onRemoveAttachment, attachmentBusy = false, attachmentError = null, webEnabled = false, webAvailable = false, onToggleWeb, agent = null, agentSaving = false }: ComposerProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [focusKey]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    const maxHeight = 180;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [text]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const value = text.trim();
    if (!value || disabled || agentSaving || (isStreaming && !onQueue)) return;
    if (isStreaming && onQueue) onQueue(value); else onSend(value);
    setText('');
    textareaRef.current?.focus();
  };

  const sendDisabled = disabled || agentSaving || (isStreaming && !onQueue) || attachmentBusy || !text.trim();
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
              {attachment.projectPath && <span className="composer-attachment-project">{t('progetto')}</span>}
              {onRemoveAttachment && (
                <button type="button" aria-label={t('Rimuovi {name}', { name: attachment.filename })} onClick={() => onRemoveAttachment(attachment.id)}>×</button>
              )}
            </span>
          ))}
          {attachmentBusy && <span className="composer-attachment is-uploading">{t('Caricamento…')}</span>}
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
      {agent && (
        <span className="composer-agent" role="img" style={{ '--agent-color': agent.color } as CSSProperties} title={t('Chat con {name}', { name: agent.name })} aria-label={t('Chat con {name}', { name: agent.name })}>
          <AppIcon name={agent.icon} size={18} />
        </span>
      )}
      {onToggleWeb && (
        <button
          type="button"
          className={`attach-button web-toggle${webEnabled ? ' is-active' : ''}`}
          aria-label={webEnabled ? t('Disattiva ricerca web') : t('Attiva ricerca web')}
          aria-pressed={webEnabled}
          title={!webAvailable ? t('Configura il provider web in amministrazione') : webEnabled ? t('Disattiva ricerca web') : t('Attiva ricerca web')}
          disabled={disabled || isStreaming || !webAvailable}
          onClick={onToggleWeb}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
        </button>
      )}
      {onFilesSelected && (
        <button
          type="button"
          className="attach-button"
          aria-label={t('Aggiungi allegati')}
          title={t('Aggiungi allegati (.md, .txt, .pdf, .docx, .html, immagini)')}
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
        placeholder={t('Scrivi un messaggio… (Invio per inviare, Shift+Invio per andare a capo)')}
        disabled={disabled || (isStreaming && !onQueue) || attachmentBusy}
        rows={1}
      />
      <div className="composer-actions">
        {isStreaming && (
          <button type="button" className="stop-button" onClick={onAbort}>
            {t('Stop')}
          </button>
        )}
        <button type="button" className="send-button" onClick={handleSend} disabled={sendDisabled}>
          {isStreaming ? (onQueue ? t('Accoda') : t('Rispondo…')) : t('Invia')}
        </button>
      </div>
    </div>
  );
}
