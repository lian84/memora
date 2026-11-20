import fs from 'node:fs/promises';
import path from 'node:path';

interface McpSecretsFile {
  version: 1;
  secrets: Record<string, string>;
}

export class McpSecretStore {
  private readonly filePath: string;
  private readonly configDir: string;
  private loaded = false;
  private secrets: Record<string, string> = {};
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.configDir = path.join(dataDir, 'config');
    this.filePath = path.join(this.configDir, 'mcp-secrets.json');
  }

  async initialize(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
      const data = raw as Partial<McpSecretsFile>;
      if (data.version !== 1 || !data.secrets || typeof data.secrets !== 'object' || Array.isArray(data.secrets)) throw new Error('invalid');
      for (const [id, value] of Object.entries(data.secrets)) {
        if (typeof value === 'string' && value.length > 0 && value.length <= 4096 && ![...value].some(char => char.charCodeAt(0) < 32)) this.secrets[id] = value;
      }
      await fs.chmod(this.filePath, 0o600).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('mcp_secrets_unreadable', { cause: error });
    }
    this.loaded = true;
  }

  async get(accountId: string): Promise<string | undefined> {
    await this.initialize();
    return this.secrets[accountId];
  }

  async has(accountId: string): Promise<boolean> {
    return Boolean(await this.get(accountId));
  }

  async set(accountId: string, token: unknown): Promise<void> {
    await this.initialize();
    if (typeof token !== 'string' || token.trim().length === 0 || token.length > 4096 || [...token].some(char => char.charCodeAt(0) < 32)) {
      throw new Error('invalid_mcp_token');
    }
    this.secrets = { ...this.secrets, [accountId]: token.trim() };
    await this.persist();
  }

  async delete(accountId: string): Promise<void> {
    await this.initialize();
    if (!(accountId in this.secrets)) return;
    const next = { ...this.secrets };
    delete next[accountId];
    this.secrets = next;
    await this.persist();
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      const payload: McpSecretsFile = { version: 1, secrets: this.secrets };
      const temporary = path.join(this.configDir, `.mcp-secrets.${process.pid}.${Date.now()}.tmp`);
      await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    });
    return this.writeChain;
  }
}
