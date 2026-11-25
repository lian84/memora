export type ServerMessageLanguage = 'it' | 'en' | 'fr';

function currentLanguage(): ServerMessageLanguage {
  if (typeof document !== 'undefined') {
    const lang = document.documentElement.lang;
    if (lang === 'it' || lang === 'en' || lang === 'fr') return lang;
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem('memora-language');
      if (stored === 'it' || stored === 'en' || stored === 'fr') return stored;
    } catch { /* storage unavailable */ }
  }
  return 'it';
}

function pick(language: ServerMessageLanguage, it: string, en: string, fr: string): string {
  return language === 'en' ? en : language === 'fr' ? fr : it;
}

const EXACT: Record<string, [string, string, string]> = {
  invalid_password: ['Password non valida.', 'Invalid password.', 'Mot de passe invalide.'],
  invalid_credentials: ['Credenziali non valide.', 'Invalid credentials.', 'Identifiants invalides.'],
  auth_already_configured: ['La password è già stata impostata.', 'A password has already been set.', 'Un mot de passe a déjà été défini.'],
  setup_required: ['Configurazione iniziale richiesta.', 'Initial setup required.', 'Configuration initiale requise.'],
  session_not_found: ['Sessione non trovata.', 'Session not found.', 'Session introuvable.'],
  project_not_found: ['Progetto non trovato.', 'Project not found.', 'Projet introuvable.'],
  section_not_found: ['Sezione non trovata.', 'Section not found.', 'Section introuvable.'],
  automation_not_found: ['Automazione non trovata.', 'Automation not found.', 'Automatisation introuvable.'],
  attachment_not_found: ['Allegato non trovato.', 'Attachment not found.', 'Pièce jointe introuvable.'],
  backup_not_found: ['Backup non trovato.', 'Backup not found.', 'Backup introuvable.'],
  export_not_found: ['Esportazione non trovata.', 'Export not found.', 'Export introuvable.'],
  project_file_not_found: ['File di progetto non trovato.', 'Project file not found.', 'Fichier du projet introuvable.'],
  maintenance: ['Manutenzione in corso: riprova tra poco.', 'Maintenance in progress: try again shortly.', 'Maintenance en cours : réessayez bientôt.'],
  backup_busy: ['Backup già in corso: riprova tra poco.', 'A backup is already running: try again shortly.', 'Un backup est déjà en cours : réessayez bientôt.'],
  backup_wrong_password: ['Password del backup errata.', 'Incorrect backup password.', 'Mot de passe du backup incorrect.'],
  backup_password_missing: ['Password del backup non configurata.', 'Backup password not configured.', 'Mot de passe du backup non configuré.'],
  backup_password_managed_by_environment: ['La password del backup è gestita dall’ambiente.', 'The backup password is managed by the environment.', 'Le mot de passe du backup est géré par l’environnement.'],
  rclone_not_installed: ['rclone non è installato sul server.', 'rclone is not installed on the server.', 'rclone n’est pas installé sur le serveur.'],
  rclone_not_configured: ['Backup remoto non configurato.', 'Remote backup is not configured.', 'Le backup distant n’est pas configuré.'],
  rclone_busy: ['Operazione rclone già in corso.', 'An rclone operation is already running.', 'Une opération rclone est déjà en cours.'],
  telegram_not_configured: ['Account Telegram non configurato.', 'Telegram account not configured.', 'Compte Telegram non configuré.'],
  telegram_unreachable: ['Telegram non raggiungibile.', 'Telegram is unreachable.', 'Telegram est injoignable.'],
  telegram_api_error: ['Errore restituito da Telegram.', 'Telegram returned an error.', 'Telegram a renvoyé une erreur.'],
  telegram_invalid_response: ['Risposta Telegram non valida.', 'Invalid Telegram response.', 'Réponse Telegram invalide.'],
  mcp_connection_failed: ['Connessione al server MCP non riuscita.', 'MCP server connection failed.', 'La connexion au serveur MCP a échoué.'],
  missing_mcp_token: ['Token MCP mancante.', 'Missing MCP token.', 'Token MCP manquant.'],
  invalid_mcp_token: ['Token MCP non valido.', 'Invalid MCP token.', 'Token MCP invalide.'],
  too_many_attachments: ['Troppi allegati per messaggio.', 'Too many attachments per message.', 'Trop de pièces jointes par message.'],
  unsupported_attachment_type: ['Tipo di allegato non supportato.', 'Unsupported attachment type.', 'Type de pièce jointe non pris en charge.'],
  model_not_found_for_provider: ['Modello non disponibile per il provider selezionato.', 'Model not available for the selected provider.', 'Modèle indisponible pour le fournisseur sélectionné.'],
  model_not_supported_for_curator: ['Modello non supportato dal Memory Curator.', 'Model not supported by the Memory Curator.', 'Modèle non pris en charge par le Memory Curator.'],
  reasoning_level_not_supported: ['Livello di reasoning non supportato.', 'Unsupported reasoning level.', 'Niveau de raisonnement non pris en charge.'],
  unsupported_preview: ['Anteprima non disponibile per questo file.', 'Preview unavailable for this file.', 'Aperçu indisponible pour ce fichier.'],
  preview_not_supported: ['Anteprima non disponibile per questo file.', 'Preview unavailable for this file.', 'Aperçu indisponible pour ce fichier.'],
  update_not_available: ['Nessun aggiornamento disponibile.', 'No update available.', 'Aucune mise à jour disponible.'],
  update_helper_missing: ['Helper di aggiornamento non installato.', 'Update helper not installed.', 'Assistant de mise à jour non installé.'],
  update_already_requested: ['Aggiornamento già richiesto.', 'Update already requested.', 'Mise à jour déjà demandée.'],
  invalid_mcp_secret_ref: ['Riferimento al token MCP non valido.', 'Invalid MCP token reference.', 'Référence de token MCP invalide.'],
  invalid_mcp_account_confirmation: ['Conferma dell’account MCP non valida.', 'Invalid MCP account confirmation.', 'Confirmation du compte MCP invalide.'],
  invalid_project_confirmation: ['Conferma del progetto non valida.', 'Invalid project confirmation.', 'Confirmation du projet invalide.'],
};

const STATUS: Record<number, [string, string, string]> = {
  400: ['Richiesta non valida.', 'Invalid request.', 'Requête invalide.'],
  401: ['Autenticazione richiesta.', 'Authentication required.', 'Authentification requise.'],
  403: ['Operazione non consentita.', 'Operation not allowed.', 'Opération non autorisée.'],
  404: ['Risorsa non trovata.', 'Resource not found.', 'Ressource introuvable.'],
  409: ['Conflitto con lo stato corrente.', 'Conflict with the current state.', 'Conflit avec l’état actuel.'],
  413: ['Contenuto troppo grande.', 'Content too large.', 'Contenu trop volumineux.'],
  429: ['Troppe richieste: riprova tra poco.', 'Too many requests: try again shortly.', 'Trop de requêtes : réessayez bientôt.'],
  500: ['Errore interno del server.', 'Internal server error.', 'Erreur interne du serveur.'],
  503: ['Servizio temporaneamente non disponibile.', 'Service temporarily unavailable.', 'Service temporairement indisponible.'],
};

/** Traduce i messaggi applicativi del backend in base alla lingua attiva. */
export function localizeServerMessage(code: string | undefined, fallback: string, status?: number, language: ServerMessageLanguage = currentLanguage()): string {
  if (code && EXACT[code]) return pick(language, ...EXACT[code]);
  if (code === 'invalid' || code?.startsWith('invalid_')) return pick(language, 'Dati non validi.', 'Invalid input.', 'Données invalides.');
  if (code?.endsWith('_not_found')) return pick(language, 'Elemento non trovato.', 'Item not found.', 'Élément introuvable.');
  if (code?.endsWith('_forbidden')) return pick(language, 'Operazione non consentita.', 'Operation not allowed.', 'Opération non autorisée.');
  if (code?.endsWith('_too_large')) return pick(language, 'Contenuto troppo grande.', 'Content too large.', 'Contenu trop volumineux.');
  if (code?.endsWith('_busy')) return pick(language, 'Operazione già in corso: riprova tra poco.', 'Operation already running: try again shortly.', 'Opération déjà en cours : réessayez bientôt.');
  if (code?.endsWith('_exists') || code?.endsWith('_already_exists')) return pick(language, 'Elemento già esistente.', 'Item already exists.', 'Élément déjà existant.');
  if (code?.endsWith('_managed_by_environment')) return pick(language, 'Valore gestito dall’ambiente.', 'Value managed by the environment.', 'Valeur gérée par l’environnement.');
  if (code?.startsWith('unsupported_')) return pick(language, 'Operazione non supportata.', 'Operation not supported.', 'Opération non prise en charge.');
  if (code?.startsWith('missing_')) return pick(language, 'Dato obbligatorio mancante.', 'Required value is missing.', 'Valeur obligatoire manquante.');
  if (!code && status && STATUS[status]) return pick(language, ...STATUS[status]);
  return fallback;
}
