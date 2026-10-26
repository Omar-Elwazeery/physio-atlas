import type { MuscleInfo } from '../types';
import { LOWER } from './muscles-lower';
import { TRUNK } from './muscles-trunk';
import { UPPER } from './muscles-upper';

export const MUSCLE_INFO: Record<string, MuscleInfo> = { ...UPPER, ...LOWER, ...TRUNK };

const GENERIC: MuscleInfo = {
  group: 'Other', region: 'Trunk', origin: 'Not yet documented', insertion: 'Not yet documented',
  innervation: 'Not yet documented', action: 'Not yet documented',
};

export const muscleInfo = (key: string): MuscleInfo => MUSCLE_INFO[key] ?? GENERIC;
export const hasMuscleInfo = (key: string) => key in MUSCLE_INFO;
