import { readFileSync } from 'node:fs';
import type { Structure } from '../app/lib/types';

/** The real converted-model manifest (all bones, muscles, discs and cartilage). */
export const structures: Structure[] = JSON.parse(
  readFileSync(new URL('../public/models/structures.json', import.meta.url), 'utf8'),
);

export const byId = new Map(structures.map((s) => [s.id, s]));
export const muscles = structures.filter((s) => s.kind === 'muscle');
