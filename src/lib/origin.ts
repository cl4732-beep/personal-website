import { parseCsvEnv } from './env';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://lacerda.cl',
  'https://www.lacerda.cl',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

export function getAllowedTracklistOrigins(): string[] {
  const configured = parseCsvEnv('TRACKLIST_ALLOWED_ORIGINS');
  const origins = configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;

  return Array.from(new Set(origins));
}

export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin);
}
