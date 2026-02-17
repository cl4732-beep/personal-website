export type EnvSource = Record<string, string | undefined>;

function readEnv(name: string, env: EnvSource = import.meta.env): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function optionalEnv(name: string, env: EnvSource = import.meta.env): string | undefined {
  return readEnv(name, env);
}

export function requiredEnv(name: string, context: string, env: EnvSource = import.meta.env): string {
  const value = readEnv(name, env);
  if (!value) {
    throw new Error(`[env] Missing required variable \"${name}\" for ${context}`);
  }
  return value;
}

export function requireEnvSet(
  names: string[],
  context: string,
  env: EnvSource = import.meta.env
): Record<string, string> {
  const missing: string[] = [];
  const values: Record<string, string> = {};

  for (const name of names) {
    const value = readEnv(name, env);
    if (!value) {
      missing.push(name);
      continue;
    }
    values[name] = value;
  }

  if (missing.length > 0) {
    throw new Error(`[env] Missing required variables for ${context}: ${missing.join(', ')}`);
  }

  return values;
}

export function parseCsvEnv(name: string, env: EnvSource = import.meta.env): string[] {
  const value = readEnv(name, env);
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
