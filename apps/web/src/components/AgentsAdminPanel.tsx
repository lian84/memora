import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { AGENT_COLOR_PALETTE, isAgentColor, type AgentProfileSummary, type AgentSkillDetail, type ProjectIcon } from '@memora/shared';
import { createAgentProfile, deleteAgentProfile, deleteAgentSkill, getAgentProfileDetail, listAgentProfiles, saveAgentSkill, updateAgentProfile } from '../lib/api';
import { useI18n } from '../i18n';
import { AppIcon } from './AppIcon';
import { ConfirmDialog } from './ConfirmDialog';
import { IconPicker } from './IconPicker';

interface ProfileForm {
  id: string;
  name: string;
  description: string;
  icon: ProjectIcon;
  color: string;
  prompt: string;
}

interface SkillForm {
  name: string;
  description: string;
  content: string;
}

const EMPTY_PROFILE: ProfileForm = { id: '', name: '', description: '', icon: 'star', color: AGENT_COLOR_PALETTE[0], prompt: '' };
const EMPTY_SKILL: SkillForm = { name: '', description: '', content: '' };

function normalizeColorInput(value: string): string | null {
  const trimmed = value.trim();
  if (isAgentColor(trimmed)) return trimmed.toLowerCase();
  const withHash = `#${trimmed}`;
  return isAgentColor(withHash) ? withHash.toLowerCase() : null;
}

function notifyProfilesChanged(): void {
  window.dispatchEvent(new Event('memora-agent-profiles-changed'));
}

export function AgentsAdminPanel() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<AgentProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [colorInput, setColorInput] = useState(EMPTY_PROFILE.color);
  const [skills, setSkills] = useState<AgentSkillDetail[]>([]);
  const [skillForm, setSkillForm] = useState<SkillForm>(EMPTY_SKILL);
  const [editingSkillName, setEditingSkillName] = useState<string | null>(null);
  const [deleteProfile, setDeleteProfile] = useState<AgentProfileSummary | null>(null);
  const [deleteSkill, setDeleteSkill] = useState<AgentSkillDetail | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadList = useCallback(async () => {
    try {
      setProfiles(await listAgentProfiles());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const resetEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingId(null);
    setForm(EMPTY_PROFILE);
    setColorInput(EMPTY_PROFILE.color);
    setSkills([]);
    setSkillForm(EMPTY_SKILL);
    setEditingSkillName(null);
    setError(null);
  }, []);

  const startNew = useCallback(() => {
    setEditorOpen(true);
    setEditingId(null);
    setForm(EMPTY_PROFILE);
    setColorInput(EMPTY_PROFILE.color);
    setSkills([]);
    setSkillForm(EMPTY_SKILL);
    setEditingSkillName(null);
    setError(null);
    setMessage(null);
  }, []);

  const startEdit = useCallback(async (profile: AgentProfileSummary) => {
    setEditorOpen(true);
    setEditingId(profile.id);
    setError(null);
    setMessage(null);
    try {
      const detail = await getAgentProfileDetail(profile.id);
      setForm({
        id: detail.id,
        name: detail.name,
        description: detail.description,
        icon: detail.icon,
        color: detail.color,
        prompt: detail.prompt,
      });
      setColorInput(detail.color);
      setSkills(detail.skills);
      setSkillForm(EMPTY_SKILL);
      setEditingSkillName(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const updateForm = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm(current => ({ ...current, [key]: value }));
    setMessage(null);
  };

  const saveProfile = useCallback(async () => {
    if (!form.name.trim()) { setError(t('Il nome dell’agente è obbligatorio.')); return; }
    if (!form.prompt.trim()) { setError(t('Il prompt del profilo è obbligatorio.')); return; }
    const normalizedColor = normalizeColorInput(colorInput);
    if (!normalizedColor) { setError(t('Colore non valido: usa un codice esadecimale come #2563eb.')); return; }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        icon: form.icon,
        color: normalizedColor,
        prompt: form.prompt,
      };
      const detail = editingId
        ? await updateAgentProfile(editingId, payload)
        : await createAgentProfile({ ...payload, id: form.id.trim() });
      setEditingId(detail.id);
      setForm({
        id: detail.id,
        name: detail.name,
        description: detail.description,
        icon: detail.icon,
        color: detail.color,
        prompt: detail.prompt,
      });
      setColorInput(detail.color);
      setSkills(detail.skills);
      setMessage(editingId ? t('Agente aggiornato.') : t('Agente creato.'));
      await loadList();
      notifyProfilesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [editingId, form, loadList, t]);

  const updateSkillForm = (key: keyof SkillForm, value: string) => {
    setSkillForm(current => ({ ...current, [key]: value }));
    setMessage(null);
  };

  const startNewSkill = () => {
    setEditingSkillName(null);
    setSkillForm(EMPTY_SKILL);
    setMessage(null);
  };

  const startEditSkill = (skill: AgentSkillDetail) => {
    setEditingSkillName(skill.name);
    setSkillForm({ name: skill.name, description: skill.description, content: skill.content });
    setMessage(null);
  };

  const saveSkill = useCallback(async () => {
    if (!editingId) { setError(t('Crea prima l’agente, poi aggiungi le competenze.')); return; }
    if (!skillForm.name.trim() || !skillForm.description.trim() || !skillForm.content.trim()) {
      setError(t('Nome, descrizione e contenuto della competenza sono obbligatori.'));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const detail = await saveAgentSkill(editingId, {
        name: skillForm.name.trim(),
        description: skillForm.description.trim(),
        content: skillForm.content,
      });
      setSkills(detail.skills);
      setSkillForm(EMPTY_SKILL);
      setEditingSkillName(null);
      setMessage(t('Competenza salvata.'));
      await loadList();
      notifyProfilesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [editingId, loadList, skillForm, t]);

  const confirmDeleteProfile = useCallback(async () => {
    if (!deleteProfile) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAgentProfile(deleteProfile.id);
      setDeleteProfile(null);
      if (editingId === deleteProfile.id) resetEditor();
      setMessage(t('Agente spostato nel cestino.'));
      await loadList();
      notifyProfilesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [deleteProfile, editingId, loadList, resetEditor, t]);

  const confirmDeleteSkill = useCallback(async () => {
    if (!deleteSkill || !editingId) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAgentSkill(editingId, deleteSkill.name);
      const detail = await getAgentProfileDetail(editingId);
      setSkills(detail.skills);
      setDeleteSkill(null);
      if (editingSkillName === deleteSkill.name) startNewSkill();
      setMessage(t('Competenza spostata nel cestino.'));
      await loadList();
      notifyProfilesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [deleteSkill, editingId, editingSkillName, loadList, t]);

  const palette = [...AGENT_COLOR_PALETTE] as string[];
  if (!palette.includes(form.color.toLowerCase())) palette.unshift(form.color);

  return (
    <div className="agents-admin">
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}

      <div className="agents-admin-layout">
        <section className="agents-admin-list" aria-label={t('Agenti')}>
          <div className="agents-admin-list-heading">
            <div>
              <h3>{t('Agenti')}</h3>
              <p className="admin-card-description">{t('Profili selezionabili prima del primo messaggio. Clicca un agente per modificarlo.')}</p>
            </div>
            <button type="button" className="admin-primary agents-admin-new-button" onClick={startNew} aria-label={t('Nuovo agente')}><span aria-hidden="true">+</span><span>{t('Nuovo agente')}</span></button>
          </div>
          {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}
          {!loading && profiles.length === 0 && <div className="admin-field-note">{t('Nessun agente configurato.')}</div>}
          <div className="agents-admin-cards">
            {profiles.map(profile => (
              <article
                key={profile.id}
                className={`agents-admin-card${editingId === profile.id ? ' is-selected' : ''}`}
                style={{ '--agent-color': profile.color } as CSSProperties}
              >
                <button type="button" className="agents-admin-card-main" title={t('Modifica agente')} onClick={() => void startEdit(profile)}>
                  <span className="agents-admin-card-icon"><AppIcon name={profile.icon} size={18} /></span>
                  <span className="agents-admin-card-copy">
                    <strong>{profile.name}</strong>
                    <small>{profile.description || t('Nessuna descrizione')}</small>
                    <em>{t('Competenze: {count}', { count: profile.skills.length })}</em>
                    <span className="agents-admin-card-edit">{t('Modifica')}</span>
                  </span>
                </button>
                <button type="button" className="agents-admin-card-delete" title={t('Elimina agente')} aria-label={t('Elimina agente')} onClick={() => setDeleteProfile(profile)}>
                  ×
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="agents-admin-editor" aria-label={t('Editor agente')}>
          {!editorOpen && (
            <div className="agents-admin-placeholder">
              <AppIcon name="lightbulb" size={24} />
              <p>{t('Seleziona un agente dalla lista o creane uno nuovo.')}</p>
            </div>
          )}
          {editorOpen && (
            <>
              <div className="agents-admin-editor-heading">
                <div>
                  <h3>{editingId ? t('Modifica agente') : t('Crea agente')}</h3>
                  <p className="admin-card-description">{t('Il profilo viene salvato in MEMORA_DATA_DIR/agents. L’ID resta bloccato; gli altri campi sono modificabili.')}</p>
                </div>
                <button type="button" className="admin-close" onClick={resetEditor}>{t('Chiudi')}</button>
              </div>

              <div className="agents-admin-form-grid">
                <label className="admin-label">{t('Nome')}
                  <input value={form.name} onChange={event => updateForm('name', event.target.value)} maxLength={120} />
                </label>
                <label className="admin-label">{t('ID agente')}
                  <input value={form.id} disabled={Boolean(editingId)} onChange={event => updateForm('id', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="commercialista" maxLength={64} />
                  <small>{t('Solo lettere minuscole, numeri e trattini. Non modificabile dopo la creazione.')}</small>
                </label>
              </div>
              <label className="admin-label">{t('Descrizione')}
                <input value={form.description} onChange={event => updateForm('description', event.target.value)} maxLength={280} />
              </label>
              <div className="agents-admin-color-row">
                <div className="admin-label agents-admin-color-label">{t('Colore')}
                  <div className="agents-admin-color-controls">
                    <div className="agents-admin-color-picker" role="group" aria-label={t('Colore')}>
                      {palette.map(color => (
                        <button
                          key={color}
                          type="button"
                          className={`agents-admin-color-swatch${form.color.toLowerCase() === color ? ' is-selected' : ''}`}
                          style={{ '--swatch': color } as CSSProperties}
                          aria-label={color}
                          aria-pressed={form.color.toLowerCase() === color}
                          title={color}
                          onClick={() => { setColorInput(color); updateForm('color', color); }}
                        />
                      ))}
                    </div>
                    <label className="agents-admin-color-hex">
                      <span>{t('Esadecimale')}</span>
                      <input
                        value={colorInput}
                        onChange={event => {
                          const value = event.target.value;
                          setColorInput(value);
                          const normalized = normalizeColorInput(value);
                          if (normalized) updateForm('color', normalized);
                        }}
                        placeholder="#2563eb"
                        aria-invalid={Boolean(colorInput.trim()) && !normalizeColorInput(colorInput)}
                        maxLength={7}
                      />
                    </label>
                  </div>
                  <small className={colorInput.trim() && !normalizeColorInput(colorInput) ? 'is-invalid' : ''}>
                    {colorInput.trim() && !normalizeColorInput(colorInput) ? t('Usa un codice esadecimale come #2563eb.') : form.color}
                  </small>
                </div>
                <div className="agents-admin-preview" style={{ '--agent-color': form.color } as CSSProperties}>
                  <span><AppIcon name={form.icon} size={18} /></span>
                  <strong>{form.name || t('Anteprima')}</strong>
                </div>
              </div>
              <label className="admin-label">{t('Icona')}
                <IconPicker value={form.icon} onChange={icon => updateForm('icon', icon)} />
              </label>
              <label className="admin-label">{t('Prompt del profilo')}
                <textarea rows={11} value={form.prompt} onChange={event => updateForm('prompt', event.target.value)} spellCheck={false} />
                <small>{t('Istruzioni di ruolo e metodo. Non possono cambiare policy, tool o permessi.')}</small>
              </label>
              <div className="admin-actions">
                <button type="button" className="admin-primary" onClick={() => void saveProfile()} disabled={saving}>{saving ? t('Salvo…') : t('Salva agente')}</button>
              </div>

              {editingId && (
                <section className="agents-admin-skills">
                  <div className="agents-admin-list-heading">
                    <div>
                      <h3>{t('Competenze')}</h3>
                      <p className="admin-card-description">{t('Caricate dal modello solo quando servono.')}</p>
                    </div>
                    <button type="button" onClick={startNewSkill}>+ {t('Aggiungi competenza')}</button>
                  </div>
                  <div className="agents-admin-skills-layout">
                    <div className="agents-admin-skill-list">
                      {skills.length === 0 && <div className="admin-field-note">{t('Nessuna competenza.')}</div>}
                      {skills.map(skill => (
                        <div className={`agents-admin-skill${editingSkillName === skill.name ? ' is-selected' : ''}`} key={skill.name}>
                          <button type="button" className="agents-admin-skill-main" onClick={() => startEditSkill(skill)}>
                            <strong>{skill.name}</strong>
                            <small>{skill.description}</small>
                          </button>
                          <button type="button" className="agents-admin-skill-delete" title={t('Elimina competenza')} aria-label={t('Elimina competenza')} onClick={() => setDeleteSkill(skill)}>×</button>
                        </div>
                      ))}
                    </div>
                    <div className="agents-admin-skill-editor">
                      <h4>{editingSkillName ? t('Modifica competenza') : t('Aggiungi competenza')}</h4>
                      <label className="admin-label">{t('Nome competenza')}
                        <input value={skillForm.name} disabled={Boolean(editingSkillName)} onChange={event => updateSkillForm('name', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="iva" maxLength={64} />
                      </label>
                      <label className="admin-label">{t('Descrizione competenza')}
                        <input value={skillForm.description} onChange={event => updateSkillForm('description', event.target.value)} maxLength={1024} />
                      </label>
                      <label className="admin-label">{t('Contenuto competenza')}
                        <textarea rows={7} value={skillForm.content} onChange={event => updateSkillForm('content', event.target.value)} spellCheck={false} placeholder={'# Procedura\n\n...'} />
                      </label>
                      <div className="admin-actions">
                        <button type="button" className="admin-primary" onClick={() => void saveSkill()} disabled={saving}>{saving ? t('Salvo…') : t('Salva competenza')}</button>
                        {editingSkillName && <button type="button" onClick={startNewSkill}>{t('Annulla')}</button>}
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </section>
      </div>

      {deleteProfile && (
        <ConfirmDialog
          title={t('Eliminare l’agente “{name}”?', { name: deleteProfile.name })}
          confirmLabel={t('Sposta nel cestino')}
          busy={deleting}
          error={error}
          onClose={() => setDeleteProfile(null)}
          onConfirm={() => void confirmDeleteProfile()}
        >
          <p>{t('Il profilo verrà spostato nel cestino. Le chat esistenti mantengono il loro snapshot.')}</p>
        </ConfirmDialog>
      )}
      {deleteSkill && (
        <ConfirmDialog
          title={t('Eliminare la competenza “{name}”?', { name: deleteSkill.name })}
          confirmLabel={t('Sposta nel cestino')}
          busy={deleting}
          error={error}
          onClose={() => setDeleteSkill(null)}
          onConfirm={() => void confirmDeleteSkill()}
        >
          <p>{t('La competenza verrà spostata nel cestino e non sarà più disponibile per le nuove chat.')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
