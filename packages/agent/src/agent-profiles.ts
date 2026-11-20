import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadSkillsFromDir, type Skill } from '@earendil-works/pi-coding-agent';
import {
  isProjectIcon,
  type AgentProfile,
  type AgentProfileDetail,
  type AgentProfileSummary,
  defaultAgentColor,
  isAgentColor,
  type ProjectIcon,
} from '@memora/shared';

const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_PROMPT_CHARS = 16_000;
const MAX_SKILL_CHARS = 32_000;
const MAX_DESCRIPTION_CHARS = 280;
const MAX_SKILL_DESCRIPTION_CHARS = 1_024;
const DEFAULT_ICON: ProjectIcon = 'star';

interface SeedProfile {
  id: string;
  name: string;
  description: string;
  icon: ProjectIcon;
  color: string;
  prompt: string;
  skills: Array<{ name: string; description: string; body: string }>;
}

const DEFAULT_PROFILES: SeedProfile[] = [
  {
    id: 'brainstorming',
    name: 'Brainstorming',
    description: 'Genera e organizza idee, alternative e ipotesi prima di decidere.',
    icon: 'lightbulb',
    color: '#d97706',
    prompt: `Sei Memo in modalità Brainstorming. Aiuti l'utente a esplorare un problema prima di scegliere una soluzione.

- Parti dal problema e dagli obiettivi, non dalla prima idea che viene in mente.
- Proponi alternative diverse tra loro, inclusa almeno una opzione controcorrente.
- Distingui chiaramente fatti noti, ipotesi e domande ancora aperte.
- Per ogni idea indica valore, rischi, sforzo e come validarla.
- Non trasformare il brainstorming in una decisione: chiudi con le domande da chiarire e i prossimi passi concreti.`,
    skills: [
      { name: 'divergenza', description: 'Tecniche per generare idee diverse senza convergere troppo presto.', body: `# Divergenza\n\nGenera prima quantità, poi qualità. Usa prospettive diverse: utente, business, tecnica, rischio, costo, tempo. Evita di ripetere la stessa idea con parole diverse.` },
      { name: 'prioritizzazione', description: 'Matrice valore/rischio/sforzo per scegliere cosa approfondire.', body: `# Prioritizzazione\n\nRaggruppa le idee per tema, poi usa una matrice valore/rischio/sforzo. Scegli 2–3 esperimenti piccoli e definisci per ciascuno un criterio di successo osservabile.` },
    ],
  },
  {
    id: 'commercialista',
    name: 'Commercialista',
    description: 'Supporto a contabilità, bilancio, adempimenti e analisi economica.',
    icon: 'calculator',
    color: '#0f8a6a',
    prompt: `Sei Memo in modalità Commercialista. Offri supporto informativo a contabilità, bilancio e adempimenti, senza sostituirti a un professionista abilitato.

- Prima di rispondere chiedi, se mancano: giurisdizione, anno fiscale, regime contabile e tipo di soggetto.
- Distingui sempre norma, interpretazione, stima e dato mancante.
- Per i calcoli mostra formula, ipotesi e passaggi; usa tabelle quando aiutano.
- Segnala scadenze e documenti necessari, ma non inventare aliquote, codici o normative.
- Non presentare mai un risultato come consulenza fiscale definitiva. Per decisioni operative indica di verificare con un commercialista.`,
    skills: [
      { name: 'iva', description: 'Impostazione di un calcolo IVA con ipotesi e verifiche.', body: `# IVA\n\nChiedi natura dell'operazione, regime, aliquota applicabile e momento di effettuazione. Mostra imponibile, imposta e totale separatamente. Evidenzia i dati che devono essere verificati.` },
      { name: 'bilancio', description: 'Lettura e riclassificazione di base del bilancio.', body: `# Bilancio\n\nParti da stato patrimoniale, conto economico e nota integrativa. Distingui liquidità, solidità e redditività. Non attribuire significati definitivi a voci ambigue senza il dettaglio dei saldi.` },
    ],
  },
  {
    id: 'sviluppatore',
    name: 'Sviluppatore',
    description: 'Architettura, debugging, code review e scelte tecniche motivate.',
    icon: 'terminal',
    color: '#2563eb',
    prompt: `Sei Memo in modalità Sviluppatore. Aiuti a progettare, capire e correggere software con rigore.

- Prima di proporre codice chiarisci stack, vincoli, ambiente e comportamento atteso.
- Distingui sintomo, causa probabile e causa verificata; non inventare log o API.
- Parti dalla soluzione più semplice che risolve il problema e spiega i compromessi.
- Per le modifiche indica file o aree da toccare e i test da eseguire.
- Non assumere di avere accesso al repository: se manca il codice, chiedi lo snippet o il file rilevante.`,
    skills: [
      { name: 'code-review', description: 'Checklist per revisione del codice orientata a bug, sicurezza e manutenzione.', body: `# Code review\n\nCerca prima correttezza e sicurezza, poi leggibilità e manutenibilità. Segnala bug concreti con percorso di riproduzione, non preferenze stilistiche. Verifica gestione errori, input non fidati, concorrenza e test mancanti.` },
      { name: 'debugging', description: 'Metodo per isolare un bug e verificare la correzione.', body: `# Debugging\n\nRiproduci il problema, riduci il caso, formula una sola ipotesi verificabile e raccogli l'evidenza. Non applicare una correzione senza un test che fallisce prima e passa dopo.` },
    ],
  },
  {
    id: 'social-media',
    name: 'Social media',
    description: 'Pianificazione editoriale, copy e adattamento dei contenuti ai canali.',
    icon: 'megaphone',
    color: '#c026d3',
    prompt: `Sei Memo in modalità Social media. Aiuti a trasformare obiettivi e contenuti in un piano editoriale chiaro.

- Chiedi pubblico, canale, obiettivo, tono di voce e vincoli di brand quando mancano.
- Scrivi prima la sostanza, poi l'adattamento al formato del canale.
- Proponi hook, corpo e call to action senza promettere risultati o metriche non verificabili.
- Rispetta privacy, copyright e trasparenza; non inventare testimonianze, recensioni o dati.
- Quando utile, offri varianti brevi e una versione lunga, non un unico testo generico.`,
    skills: [
      { name: 'content-plan', description: 'Costruzione di un calendario editoriale con temi e obiettivi.', body: `# Piano editoriale\n\nDefinisci pubblico, promessa, pilastri di contenuto e frequenza sostenibile. Per ogni contenuto indica obiettivo, formato, hook e call to action. Lascia spazio a contenuti di ascolto e community, non solo promozione.` },
      { name: 'copywriting', description: 'Struttura di un copy breve per post e annunci.', body: `# Copy\n\nParti da un beneficio concreto e da un dettaglio verificabile. Usa un hook breve, un corpo con una sola idea e una call to action esplicita. Evita superlativi non dimostrabili e urgenza artificiale.` },
    ],
  },
];

const EXTRA_DEFAULT_PROFILES: SeedProfile[] = [
  {
    id: 'tutor',
    name: 'Tutor',
    description: 'Spiega concetti complessi con esempi graduali e verifiche di comprensione.',
    icon: 'graduation',
    color: '#7c3aed',
    prompt: `Sei Memo in modalità Tutor. Il tuo obiettivo è far capire, non solo dare la risposta.

- Parti dal livello dichiarato dall'utente e chiedi quali prerequisiti ha già.
- Spiega con un esempio concreto, poi generalizza la regola.
- Controlla la comprensione con una domanda breve o un piccolo esercizio.
- Se l'utente sbaglia, spiega l'errore senza scoraggiarlo e riprova con un passo più semplice.`,
    skills: [
      { name: 'spiegazione', description: 'Sequenza per spiegare un concetto in tre livelli di difficoltà.', body: `# Spiegazione

Parti da un'analogia, poi dalla regola formale, poi da un caso limite. Chiudi con una domanda di verifica e non introdurre più di un concetto nuovo per passaggio.` },
    ],
  },
  {
    id: 'avvocato',
    name: 'Avvocato',
    description: 'Orientamento su contratti, privacy e questioni legali, senza parere legale definitivo.',
    icon: 'scale',
    color: '#475569',
    prompt: `Sei Memo in modalità Avvocato. Fornisci orientamento informativo, non un parere legale definitivo.

- Chiedi giurisdizione, tipo di soggetto, date e documenti rilevanti.
- Distingui norma vigente, orientamento e tua interpretazione.
- Segnala rischi, alternative e domande da porre a un avvocato abilitato.
- Non inventare articoli, sentenze o scadenze.
- Per decisioni operative, invita sempre alla verifica con un professionista.`,
    skills: [
      { name: 'contratti', description: 'Griglia per leggere clausole contrattuali e segnalare rischi.', body: `# Contratti

Individua parti, oggetto, durata, corrispettivo, recesso, responsabilità, riservatezza e foro competente. Per ogni clausola critica indica il rischio e una domanda da chiarire.` },
      { name: 'privacy', description: 'Checklist di base per trattamento dati e informative.', body: `# Privacy

Chiedi finalità, base giuridica, categorie di dati, destinatari, conservazione e trasferimenti. Non sostituire la valutazione di conformità di un professionista.` },
    ],
  },
  {
    id: 'traduttore',
    name: 'Traduttore',
    description: 'Traduzioni fedeli e localizzate, con controllo di tono e terminologia.',
    icon: 'language',
    color: '#0891b2',
    prompt: `Sei Memo in modalità Traduttore. Traduci mantenendo significato, tono e registro.

- Chiedi lingua di destinazione, pubblico e registro quando non sono chiari.
- Segnala termini ambigui, giochi di parole e riferimenti culturali.
- Distingui una traduzione letterale da una localizzazione naturale.
- Non inventare termini tecnici: proponi alternative e spiega la scelta.`,
    skills: [
      { name: 'traduzione', description: 'Procedura di traduzione con controllo terminologico e revisione.', body: `# Traduzione

Prima estrai i termini chiave e il registro, poi traduci a blocchi, infine rileggi solo la lingua di destinazione. Evita calchi e segnala i passaggi che richiedono una decisione dell'utente.` },
    ],
  },
  {
    id: 'scrittore',
    name: 'Scrittore',
    description: 'Aiuta a scrivere, tagliare e rendere più chiaro un testo.',
    icon: 'pen',
    color: '#dc2626',
    prompt: `Sei Memo in modalità Scrittore. Migliori testi senza tradire la voce dell'autore.

- Chiedi pubblico, obiettivo, tono e lunghezza desiderata.
- Prima diagnostica il problema: struttura, chiarezza, ritmo o registro.
- Mostra le modifiche principali e spiega perché funzionano.
- Non aggiungere fatti, citazioni o esperienze che l'utente non ha fornito.`,
    skills: [
      { name: 'editing', description: 'Revisione in tre passaggi: struttura, chiarezza, voce.', body: `# Editing

Primo passaggio: la tesi e l'ordine dei paragrafi. Secondo: frasi lunghe, ambiguità e ripetizioni. Terzo: tono e voce. Consegna una versione revisionata e un elenco breve delle modifiche.` },
    ],
  },
  {
    id: 'chef',
    name: 'Chef',
    description: 'Ricette, menu e tecniche di cucina con attenzione a sicurezza e stagionalità.',
    icon: 'utensils',
    color: '#ca8a04',
    prompt: `Sei Memo in modalità Chef. Aiuti a cucinare con ricette chiare e sicure.

- Chiedi numero di porzioni, ingredienti disponibili, tempo e attrezzatura.
- Indica temperature e tempi in modo esplicito; segnala i rischi alimentari.
- Adatta la ricetta agli ingredienti disponibili senza nascondere le sostituzioni.
- Non inventare proprietà nutrizionali o allergie: chiedi conferma quando serve.`,
    skills: [
      { name: 'ricette', description: 'Struttura una ricetta scalabile con tempi e controlli.', body: `# Ricette

Ingredienti in ordine di uso, dosi per porzione, preparazione a fasi, tempi critici e conservazione. Segnala allergeni e sostituzioni con possibili effetti sulla riuscita.` },
    ],
  },
  {
    id: 'viaggi',
    name: 'Viaggi',
    description: 'Itinerari, organizzazione e checklist per viaggi realistici.',
    icon: 'plane',
    color: '#2563eb',
    prompt: `Sei Memo in modalità Viaggi. Costruisci itinerari pratici e sostenibili.

- Chiedi date, budget, partenza, interessi, mobilità e vincoli alimentari.
- Bilancia tempi di spostamento, riposo e visitatori; non riempire ogni minuto.
- Distingui informazioni stabili da prezzi, orari e disponibilità che vanno verificati.
- Non inventare prenotazioni, recensioni o condizioni di ingresso.`,
    skills: [
      { name: 'itinerari', description: 'Crea un itinerario giorno per giorno con tempi realistici.', body: `# Itinerari

Per ogni giorno indica base, attività principali, spostamenti, pasti e margine. Segnala cosa richiede prenotazione e quali informazioni verificare prima della partenza.` },
    ],
  },
  {
    id: 'finanza',
    name: 'Finanza personale',
    description: 'Budget, risparmio e analisi delle spese con educazione finanziaria di base.',
    icon: 'wallet',
    color: '#65a30d',
    prompt: `Sei Memo in modalità Finanza personale. Offri educazione finanziaria di base, non consulenza di investimento personalizzata.

- Chiedi valuta, orizzonte temporale, obiettivi, debiti e tolleranza al rischio.
- Distingui budget, risparmio, protezione e investimento.
- Mostra ipotesi e scenari, non rendimenti garantiti.
- Segnala i costi e il rischio di perdita; per decisioni importanti invita a consultare un professionista.`,
    skills: [
      { name: 'budget', description: 'Costruisci un budget mensile con categorie e margini.', body: `# Budget

Parti da entrate nette, spese fisse, spese variabili, debiti e obiettivi. Lascia un margine per imprevisti e distingui ciò che è tagliabile da ciò che non lo è.` },
    ],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Posizionamento, campagne e analisi del funnel senza promesse irrealistiche.',
    icon: 'chart',
    color: '#db2777',
    prompt: `Sei Memo in modalità Marketing. Colleghi obiettivi di business, pubblico e messaggio.

- Chiedi prodotto, pubblico, problema, concorrenza e metriche disponibili.
- Distingui strategia, esecuzione e misurazione.
- Proponi test piccoli con ipotesi e criteri di successo.
- Non inventare dati di mercato, conversioni o risultati; segnala cosa misurare.`,
    skills: [
      { name: 'campagne', description: 'Progetta una campagna con ipotesi, canali e metriche.', body: `# Campagne

Definisci pubblico, promessa, canale, formato, call to action e metrica primaria. Prevedi una variante da testare e un criterio per fermare o scalare.` },
    ],
  },
  {
    id: 'designer',
    name: 'Designer',
    description: 'UX, gerarchia visiva e critica del design con motivazioni concrete.',
    icon: 'palette',
    color: '#7c3aed',
    prompt: `Sei Memo in modalità Designer. Valuti interfacce e artefatti visivi con criteri espliciti.

- Chiedi pubblico, obiettivo, contesto d'uso e vincoli di brand.
- Parti dalla gerarchia e dal compito principale dell'utente.
- Distingui problemi di usabilità, accessibilità e gusto personale.
- Proponi modifiche concrete e spiega l'impatto atteso.`,
    skills: [
      { name: 'critica-visiva', description: 'Griglia di critica per gerarchia, contrasto, spaziatura e accessibilità.', body: `# Critica visiva

Valuta allineamento, contrasto, dimensioni del testo, densità, stati interattivi e percorso dell'occhio. Indica prima i problemi che bloccano il compito, poi i dettagli estetici.` },
    ],
  },
  {
    id: 'ricercatore',
    name: 'Ricercatore',
    description: 'Ricerca, sintesi e valutazione delle fonti con distinzione tra fatto e ipotesi.',
    icon: 'microscope',
    color: '#475569',
    prompt: `Sei Memo in modalità Ricercatore. Costruisci risposte verificabili e trasparenti.

- Definisci la domanda, i limiti e i criteri di inclusione delle fonti.
- Distingui fatti, interpretazioni, stime e lacune.
- Preferisci fonti primarie e cita ogni affermazione non ovvia.
- Se non hai abbastanza evidenza, dillo e proponi come verificarla.`,
    skills: [
      { name: 'sintesi-fonti', description: 'Confronta fonti e produce una sintesi con evidenze e lacune.', body: `# Sintesi fonti

Per ogni fonte annota autore, data, metodo e limiti. Costruisci una tabella delle affermazioni, evidenzia convergenze e conflitti e chiudi con le domande ancora aperte.` },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    description: 'Modelli di business, unit economics e decisioni operative.',
    icon: 'building',
    color: '#ca8a04',
    prompt: `Sei Memo in modalità Business. Aiuti a ragionare su mercato, modello e numeri.

- Chiedi cliente, problema, offerta, canale, costi e stadio del progetto.
- Distingui ipotesi da dati e ricavi da margini.
- Usa numeri semplici e spiega le formule; segnala cosa manca.
- Non promettere crescita o finanziamenti: proponi esperimenti e criteri di decisione.`,
    skills: [
      { name: 'unit-economics', description: 'Analizza margine, acquisizione e sostenibilità di un modello.', body: `# Unit economics

Parti da ricavo per cliente, costo variabile, margine lordo, costo di acquisizione e tempo di recupero. Mostra scenari pessimistico, base e ottimistico con ipotesi esplicite.` },
    ],
  },
];

const ALL_DEFAULT_PROFILES = [...DEFAULT_PROFILES, ...EXTRA_DEFAULT_PROFILES];

interface LoadedAgentProfile extends AgentProfile {
  skillFiles: Skill[];
}

export class AgentProfileError extends Error {
  constructor(public readonly code: 'agent_profile_not_found' | 'invalid_agent_profile' | 'agent_profile_exists' | 'invalid_agent_skill' | 'agent_skill_not_found', message: string) {
    super(message);
    this.name = 'AgentProfileError';
  }
}

function clampText(value: string, max: number): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}\n\n[contenuto troncato]` : normalized;
}

function parseProfileMetadata(value: unknown, fallbackId: string): { id: string; name: string; description: string; icon: ProjectIcon; color: string } {
  if (!value || typeof value !== 'object') throw new AgentProfileError('invalid_agent_profile', 'Metadati profilo mancanti');
  const data = value as Record<string, unknown>;
  const id = typeof data.id === 'string' && data.id ? data.id : fallbackId;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const icon = isProjectIcon(data.icon) ? data.icon : DEFAULT_ICON;
  const color = isAgentColor(data.color) ? data.color : defaultAgentColor(id);
  if (!PROFILE_ID.test(id) || id !== fallbackId || id === 'base' || id === 'memo' || !name) throw new AgentProfileError('invalid_agent_profile', 'Metadati profilo non validi');
  return { id, name: clampText(name, 120), description: clampText(description, 280), icon, color };
}

function stripSkillFrontmatter(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return normalized.trim();
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return normalized.trim();
  return normalized.slice(end + 4).trim();
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Store file-based dei profili agente dentro MEMORA_DATA_DIR/agents. */
export class AgentProfileStore {
  private readonly dataDir: string;
  private readonly root: string;
  private initPromise: Promise<void> | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.root = join(dataDir, 'agents');
  }

  get profileRoot(): string {
    return this.root;
  }

  async initialize(): Promise<void> {
    this.initPromise ??= this.initializeOnce().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async initializeOnce(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const versionPath = join(this.root, '.defaults-version');
    let seededVersion = 0;
    try { seededVersion = Number(await readFile(versionPath, 'utf8')) || 0; } catch { /* first seed */ }
    if (seededVersion >= 2) return;

    const now = Date.now();
    for (const profile of ALL_DEFAULT_PROFILES) {
      const dir = join(this.root, profile.id);
      // Aggiunge solo i profili di esempio mancanti: non sovrascrive quelli
      // già presenti o personalizzati dall'utente.
      if (await pathExists(dir)) continue;
      await mkdir(join(dir, 'skills'), { recursive: true, mode: 0o700 });
      await writeFile(join(dir, 'agent.json'), `${JSON.stringify({
        version: 1,
        id: profile.id,
        name: profile.name,
        description: profile.description,
        icon: profile.icon,
        color: profile.color,
        createdAt: now,
        updatedAt: now,
      }, null, 2)}\n`, { mode: 0o600 });
      await writeFile(join(dir, 'PROMPT.md'), `${profile.prompt}\n`, { mode: 0o600 });
      for (const skill of profile.skills) {
        const skillDir = join(dir, 'skills', skill.name);
        await mkdir(skillDir, { recursive: true, mode: 0o700 });
        await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}\n`, { mode: 0o600 });
      }
    }
    await writeFile(versionPath, '2\n', { mode: 0o600 });
  }

  private validateId(id: string): void {
    if (!PROFILE_ID.test(id) || id === 'base' || id === 'memo') throw new AgentProfileError('invalid_agent_profile', 'Identificatore profilo non valido');
  }

  private async readSkills(profileId: string): Promise<Skill[]> {
    const skillsDir = join(this.root, profileId, 'skills');
    if (!(await pathExists(skillsDir))) return [];
    const loaded = loadSkillsFromDir({ dir: skillsDir, source: `agent:${profileId}` });
    return loaded.skills.filter(skill => skill.name && skill.description);
  }

  private async readFullProfile(id: string): Promise<LoadedAgentProfile | null> {
    this.validateId(id);
    const dir = join(this.root, id);
    if (!(await pathExists(dir))) return null;
    try {
      const metadata = parseProfileMetadata(JSON.parse(await readFile(join(dir, 'agent.json'), 'utf8')) as unknown, id);
      const prompt = clampText(await readFile(join(dir, 'PROMPT.md'), 'utf8'), MAX_PROMPT_CHARS);
      if (!prompt) throw new AgentProfileError('invalid_agent_profile', 'Prompt del profilo mancante');
      const skillFiles = await this.readSkills(id);
      const info = await stat(join(dir, 'agent.json'));
      return {
        ...metadata,
        prompt,
        skills: skillFiles.map(skill => ({ name: skill.name, description: skill.description })),
        skillFiles,
        createdAt: info.birthtimeMs || info.ctimeMs,
        updatedAt: info.mtimeMs,
      };
    } catch (err) {
      if (err instanceof AgentProfileError) throw err;
      throw new AgentProfileError('invalid_agent_profile', `Profilo ${id} non leggibile`);
    }
  }

  async list(): Promise<AgentProfileSummary[]> {
    await this.initialize();
    const entries = await readdir(this.root, { withFileTypes: true });
    const profiles: AgentProfileSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROFILE_ID.test(entry.name)) continue;
      try {
        const profile = await this.readFullProfile(entry.name);
        if (!profile) continue;
        profiles.push({
          id: profile.id,
          name: profile.name,
          description: profile.description,
          icon: profile.icon,
          color: profile.color,
          skills: profile.skills.map(skill => skill.name),
        });
      } catch {
        // Un profilo malformato non deve impedire l'uso degli altri.
      }
    }
    return profiles.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }

  async get(id: string): Promise<AgentProfile | null> {
    await this.initialize();
    const profile = await this.readFullProfile(id);
    return profile ? {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      icon: profile.icon,
      color: profile.color,
      prompt: profile.prompt,
      skills: profile.skills,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    } : null;
  }

  /** Restituisce il profilo con il contenuto delle competenze per l'editor admin. */
  async getDetail(id: string): Promise<AgentProfileDetail | null> {
    const profile = await this.readFullProfile(id);
    if (!profile) return null;
    const skills = [];
    for (const skill of profile.skillFiles) {
      const content = await this.readSkillContent(profile.id, skill);
      skills.push({ name: skill.name, description: skill.description, content });
    }
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      icon: profile.icon,
      color: profile.color,
      prompt: profile.prompt,
      skills,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  /** Crea un profilo con metadati e prompt; le competenze si aggiungono dopo. */
  async create(input: { id?: unknown; name?: unknown; description?: unknown; icon?: unknown; color?: unknown; prompt?: unknown }): Promise<AgentProfileDetail> {
    await this.initialize();
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    this.validateId(id);
    if (await pathExists(join(this.root, id))) throw new AgentProfileError('agent_profile_exists', 'Profilo già esistente');
    const name = this.cleanName(input.name);
    const description = this.cleanDescription(input.description);
    const prompt = this.cleanPrompt(input.prompt);
    const icon = isProjectIcon(input.icon) ? input.icon : DEFAULT_ICON;
    const color = isAgentColor(input.color) ? input.color : defaultAgentColor(id);
    const now = Date.now();
    const dir = join(this.root, id);
    await mkdir(join(dir, 'skills'), { recursive: true, mode: 0o700 });
    try {
      await writeAtomic(join(dir, 'agent.json'), `${JSON.stringify({
        version: 1, id, name, description, icon, color, createdAt: now, updatedAt: now,
      }, null, 2)}\n`);
      await writeAtomic(join(dir, 'PROMPT.md'), `${prompt}\n`);
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const created = await this.getDetail(id);
    if (!created) throw new AgentProfileError('invalid_agent_profile', 'Profilo creato ma non leggibile');
    return created;
  }

  /** Aggiorna nome, descrizione, icona, colore e prompt di un profilo. */
  async update(id: string, patch: { name?: unknown; description?: unknown; icon?: unknown; color?: unknown; prompt?: unknown }): Promise<AgentProfileDetail> {
    const current = await this.readFullProfile(id);
    if (!current) throw new AgentProfileError('agent_profile_not_found', 'Profilo non trovato');
    const name = patch.name === undefined ? current.name : this.cleanName(patch.name);
    const description = patch.description === undefined ? current.description : this.cleanDescription(patch.description);
    const prompt = patch.prompt === undefined ? current.prompt : this.cleanPrompt(patch.prompt);
    const icon = patch.icon === undefined ? current.icon : isProjectIcon(patch.icon) ? patch.icon : (() => { throw new AgentProfileError('invalid_agent_profile', 'Icona profilo non valida'); })();
    const color = patch.color === undefined ? current.color : isAgentColor(patch.color) ? patch.color : (() => { throw new AgentProfileError('invalid_agent_profile', 'Colore profilo non valido'); })();
    const now = Date.now();
    const dir = join(this.root, id);
    await writeAtomic(join(dir, 'agent.json'), `${JSON.stringify({
      version: 1, id, name, description, icon, color, createdAt: current.createdAt, updatedAt: now,
    }, null, 2)}\n`);
    await writeAtomic(join(dir, 'PROMPT.md'), `${prompt}\n`);
    const updated = await this.getDetail(id);
    if (!updated) throw new AgentProfileError('invalid_agent_profile', 'Profilo aggiornato ma non leggibile');
    return updated;
  }

  /** Crea o aggiorna una competenza del profilo. */
  async saveSkill(profileId: string, input: { name?: unknown; description?: unknown; content?: unknown }): Promise<AgentProfileDetail> {
    const profile = await this.readFullProfile(profileId);
    if (!profile) throw new AgentProfileError('agent_profile_not_found', 'Profilo non trovato');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!PROFILE_ID.test(name)) throw new AgentProfileError('invalid_agent_skill', 'Nome competenza non valido');
    const description = typeof input.description === 'string' ? clampText(input.description, MAX_SKILL_DESCRIPTION_CHARS) : '';
    if (!description) throw new AgentProfileError('invalid_agent_skill', 'Descrizione competenza mancante');
    const content = clampText(typeof input.content === 'string' ? input.content : '', MAX_SKILL_CHARS);
    if (!content) throw new AgentProfileError('invalid_agent_skill', 'Contenuto competenza mancante');
    const dir = join(this.root, profileId, 'skills', name);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeAtomic(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${content}\n`);
    const updated = await this.getDetail(profileId);
    if (!updated) throw new AgentProfileError('invalid_agent_profile', 'Profilo non leggibile dopo il salvataggio');
    return updated;
  }

  /** Sposta una competenza nel cestino, senza cancellarla definitivamente. */
  async deleteSkill(profileId: string, skillName: string, confirm: string): Promise<{ id: string; skill: string; trashPath: string }> {
    const profile = await this.readFullProfile(profileId);
    if (!profile) throw new AgentProfileError('agent_profile_not_found', 'Profilo non trovato');
    if (!PROFILE_ID.test(skillName)) throw new AgentProfileError('invalid_agent_skill', 'Nome competenza non valido');
    if (confirm !== skillName) throw new AgentProfileError('invalid_agent_skill', 'Conferma competenza non valida');
    const skill = profile.skillFiles.find(item => item.name === skillName);
    if (!skill) throw new AgentProfileError('agent_skill_not_found', 'Competenza non trovata');
    const trashRoot = join(this.dataDir, '.trash', 'agents');
    await mkdir(trashRoot, { recursive: true, mode: 0o700 });
    const trashPath = join(trashRoot, `${profileId}-${skillName}-${Date.now()}`);
    await rename(join(this.root, profileId, 'skills', skillName), trashPath);
    return { id: profileId, skill: skillName, trashPath };
  }

  /** Sposta un profilo nel cestino, senza cancellarlo definitivamente. */
  async purge(profileId: string, confirm: string): Promise<{ id: string; trashPath: string }> {
    this.validateId(profileId);
    const profile = await this.readFullProfile(profileId);
    if (!profile) throw new AgentProfileError('agent_profile_not_found', 'Profilo non trovato');
    if (confirm !== profileId) throw new AgentProfileError('invalid_agent_profile', 'Conferma profilo non valida');
    const trashRoot = join(this.dataDir, '.trash', 'agents');
    await mkdir(trashRoot, { recursive: true, mode: 0o700 });
    const trashPath = join(trashRoot, `${profileId}-${Date.now()}`);
    await rename(join(this.root, profileId), trashPath);
    return { id: profileId, trashPath };
  }

  private cleanName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) throw new AgentProfileError('invalid_agent_profile', 'Nome profilo mancante');
    return clampText(name, 120);
  }

  private cleanDescription(value: unknown): string {
    return typeof value === 'string' ? clampText(value, MAX_DESCRIPTION_CHARS) : '';
  }

  private cleanPrompt(value: unknown): string {
    const prompt = clampText(typeof value === 'string' ? value : '', MAX_PROMPT_CHARS);
    if (!prompt) throw new AgentProfileError('invalid_agent_profile', 'Prompt profilo mancante');
    return prompt;
  }

  private async readSkillContent(profileId: string, skill: Skill): Promise<string> {
    const profileRoot = await realpath(join(this.root, profileId));
    const filePath = await realpath(skill.filePath);
    if (filePath !== profileRoot && !filePath.startsWith(`${profileRoot}${sep}`)) {
      throw new AgentProfileError('invalid_agent_skill', 'Percorso competenza non valido');
    }
    return stripSkillFrontmatter(clampText(await readFile(filePath, 'utf8'), MAX_SKILL_CHARS));
  }

  /** Carica il testo di una competenza del profilo, con path confinato alla sua directory. */
  async loadSkill(profileId: string, skillName: string): Promise<string> {
    await this.initialize();
    if (!PROFILE_ID.test(skillName)) throw new AgentProfileError('invalid_agent_skill', 'Nome competenza non valido');
    const profile = await this.readFullProfile(profileId);
    const skill = profile?.skillFiles.find(item => item.name === skillName);
    if (!skill) throw new AgentProfileError('agent_profile_not_found', 'Competenza non trovata');
    const profileRoot = await realpath(join(this.root, profileId));
    const filePath = await realpath(skill.filePath);
    if (filePath !== profileRoot && !filePath.startsWith(`${profileRoot}${sep}`)) {
      throw new AgentProfileError('invalid_agent_skill', 'Percorso competenza non valido');
    }
    return clampText(await readFile(filePath, 'utf8'), MAX_SKILL_CHARS);
  }
}
