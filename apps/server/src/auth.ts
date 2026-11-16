import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

interface AuthFile {
  version: 1;
  salt: string;
  hash: string;
  params: typeof SCRYPT;
  sessionSecret: string;
  sessionVersion: number;
  createdAt: number;
  updatedAt: number;
}

interface SessionPayload {
  v: 1;
  iat: number;
  exp: number;
  sv: number;
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH || [...password].some(char => char.charCodeAt(0) === 0)) {
    throw new AuthError('invalid_password', `La password deve avere tra ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caratteri`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseAuthFile(raw: string): AuthFile {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new AuthError('invalid_auth_store', 'File di autenticazione non valido'); }
  if (!isRecord(value) || value.version !== 1) throw new AuthError('invalid_auth_store', 'File di autenticazione non valido');
  if (typeof value.salt !== 'string' || typeof value.hash !== 'string' || typeof value.sessionSecret !== 'string') throw new AuthError('invalid_auth_store', 'File di autenticazione non valido');
  if (!Number.isSafeInteger(value.sessionVersion) || Number(value.sessionVersion) < 1) throw new AuthError('invalid_auth_store', 'File di autenticazione non valido');
  const params = isRecord(value.params) ? value.params : null;
  if (!params || params.N !== SCRYPT.N || params.r !== SCRYPT.r || params.p !== SCRYPT.p || params.keylen !== SCRYPT.keylen) throw new AuthError('invalid_auth_store', 'File di autenticazione non valido');
  return {
    version: 1,
    salt: value.salt,
    hash: value.hash,
    params: SCRYPT,
    sessionSecret: value.sessionSecret,
    sessionVersion: Number(value.sessionVersion),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export class AuthStore {
  private readonly filePath: string;
  private data: AuthFile | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'config', 'auth.json');
  }

  get setupRequired(): boolean { return this.data === null; }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = parseAuthFile(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.data = null; return; }
      if (error instanceof AuthError) throw error;
      throw new AuthError('invalid_auth_store', 'File di autenticazione non valido');
    }
  }

  private async makeFile(password: string): Promise<AuthFile> {
    validatePassword(password);
    const salt = crypto.randomBytes(32).toString('base64');
    const hash = (await derive(password, salt)).toString('base64');
    const now = Date.now();
    return {
      version: 1,
      salt,
      hash,
      params: SCRYPT,
      sessionSecret: crypto.randomBytes(32).toString('base64'),
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async write(data: AuthFile, flag: 'w' | 'wx' = 'w'): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const content = `${JSON.stringify(data, null, 2)}\n`;
    if (flag === 'wx') {
      await fs.writeFile(this.filePath, content, { mode: 0o600, flag });
      return;
    }
    const temp = `${this.filePath}.tmp-${crypto.randomUUID()}`;
    await fs.writeFile(temp, content, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, this.filePath);
    await fs.chmod(this.filePath, 0o600);
  }

  async setup(password: string): Promise<void> {
    if (this.data) throw new AuthError('auth_already_configured', 'Autenticazione già configurata');
    const data = await this.makeFile(password);
    try {
      await this.write(data, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AuthError('auth_already_configured', 'Autenticazione già configurata');
      throw error;
    }
    this.data = data;
  }

  async resetPassword(password: string): Promise<void> {
    const data = await this.makeFile(password);
    await this.write(data);
    this.data = data;
  }

  async verifyPassword(password: unknown): Promise<boolean> {
    if (!this.data || typeof password !== 'string') return false;
    const candidate = await derive(password, this.data.salt);
    const expected = Buffer.from(this.data.hash, 'base64');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }

  createSession(): string {
    if (!this.data) throw new AuthError('setup_required', 'Configurare la password');
    const now = Date.now();
    const payload: SessionPayload = { v: 1, iat: now, exp: now + SESSION_TTL_MS, sv: this.data.sessionVersion };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.data.sessionSecret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  verifySession(token: string | undefined): boolean {
    if (!this.data || !token) return false;
    const [body, signature] = token.split('.');
    if (!body || !signature) return false;
    const expected = crypto.createHmac('sha256', this.data.sessionSecret).update(body).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload>;
      return payload.v === 1 && typeof payload.exp === 'number' && payload.exp > Date.now() && payload.sv === this.data.sessionVersion;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    if (!this.data) return;
    this.data = { ...this.data, sessionVersion: this.data.sessionVersion + 1, updatedAt: Date.now() };
    await this.write(this.data);
  }
}

export const AUTH_COOKIE = 'memora_session';
export const AUTH_COOKIE_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;
export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH };
