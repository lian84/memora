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
    if (await pathExists(this.root)) return;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const now = Date.now();
    for (const profile of DEFAULT_PROFILES) {
      const dir = join(this.root, profile.id);
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
