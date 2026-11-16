/** Legge una variabile MEMORA_* dall'ambiente. */
export function memoraEnv(name, env = process.env) {
  return env[`MEMORA_${name}`];
}
