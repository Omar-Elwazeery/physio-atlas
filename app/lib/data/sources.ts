import type { MuscleInfo } from '../types';
import { MUSCLE_INFO } from './muscles';

/**
 * Registry of standard references that muscle entries are meant to be checked against. A muscle lists the ones it was
 * actually checked against in `refs` (ids from here), and who did the check in `reviewed`. Being listed here says
 * nothing about any entry: no entry in the data files has been checked yet, so none carries `refs` or `reviewed`.
 * Book level only (no page numbers). Leave out an edition or year rather than guess it.
 */
export interface Source {
  id: string;
  authors: string;
  title: string;
  edition?: string;
  publisher: string;
  year?: number;
}

export const SOURCES: Record<string, Source> = {
  gray: { id: 'gray', authors: 'Standring S (ed.)', title: "Gray's Anatomy: The Anatomical Basis of Clinical Practice", edition: '42nd edition', publisher: 'Elsevier', year: 2020 },
  moore: { id: 'moore', authors: 'Dalley AF, Agur AMR', title: "Moore's Clinically Oriented Anatomy", edition: '9th edition', publisher: 'Wolters Kluwer', year: 2022 },
  kendall: { id: 'kendall', authors: 'Conroy VM, Murray B, Alexopulos Q', title: "Kendall's Muscles: Testing and Function with Posture and Pain", edition: '6th edition', publisher: 'Wolters Kluwer', year: 2023 },
  neumann: { id: 'neumann', authors: 'Neumann DA', title: "Neumann's Kinesiology of the Musculoskeletal System", edition: '4th edition', publisher: 'Elsevier', year: 2024 },
  palastanga: { id: 'palastanga', authors: 'Soames R, Palastanga N', title: 'Anatomy and Human Movement: Structure and Function', edition: '7th edition', publisher: 'Elsevier', year: 2019 },
};

export const SOURCE_LIST: Source[] = Object.values(SOURCES);

/** "Authors. Title. Edition. Publisher, year." with any missing part left out. */
export const citation = (s: Source): string =>
  `${s.authors}. ${s.title}.${s.edition ? ` ${s.edition}.` : ''} ${s.publisher}${s.year ? `, ${s.year}` : ''}.`;

/** The contributing guide on the project's public repository (see `git remote`), where verification is explained. */
export const CONTRIBUTING_URL = 'https://github.com/Omar-Elwazeery/physio-atlas/blob/main/CONTRIBUTING.md';

export interface ReviewStats {
  total: number;
  /** Entries that list at least one reference. */
  withRefs: number;
  /** Entries with a `reviewed` record. */
  reviewed: number;
  /** Reference ids used by entries that are not in the registry (should be empty). */
  unknownRefs: string[];
}

/** How much of the muscle data has been checked against a reference. Today: none of it. */
export function reviewStats(info: Record<string, MuscleInfo> = MUSCLE_INFO): ReviewStats {
  const unknown = new Set<string>();
  let withRefs = 0, reviewed = 0;
  for (const m of Object.values(info)) {
    if (m.refs?.length) withRefs++;
    if (m.reviewed) reviewed++;
    for (const r of m.refs ?? []) if (!SOURCES[r]) unknown.add(r);
  }
  return { total: Object.keys(info).length, withRefs, reviewed, unknownRefs: [...unknown] };
}
