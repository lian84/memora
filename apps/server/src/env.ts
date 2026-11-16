/** Legge una variabile MEMORA_* dall'ambiente. */
export function memoraEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`MEMORA_${name}`];
}
