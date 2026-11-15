'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ROLE_PALETTES, type PaletteName, type Viewer } from '../lib/three/viewer';
import type { Role } from '../lib/data/actions';

const STORAGE_KEY = 'physio-atlas.palette';

export const hexColor = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function stored(): PaletteName {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && Object.prototype.hasOwnProperty.call(ROLE_PALETTES, v)) return v as PaletteName;
  } catch { /* storage blocked */ }
  return 'default';
}

/**
 * Role colour palette (default or colour-blind safe), persisted per browser. `roleVars` exposes the
 * colours as CSS custom properties (`--role-prime`, `--role-assist`, `--role-stab`, `--role-antagonist`)
 * for the interface chrome; the loaded viewer gets the same palette through `setPalette`.
 */
export function usePalette(viewer: Viewer | null) {
  const [palette, setPaletteState] = useState<PaletteName>(stored);

  useEffect(() => { viewer?.setPalette(palette); }, [palette, viewer]);

  const setPalette = useCallback((p: PaletteName) => {
    setPaletteState(p);
    try { window.localStorage.setItem(STORAGE_KEY, p); } catch { /* storage blocked */ }
  }, []);

  const colors = ROLE_PALETTES[palette];
  const roleVars = useMemo(() => {
    const vars: Record<string, string> = {};
    for (const [role, c] of Object.entries(colors) as [Role, number][]) vars[`--role-${role}`] = hexColor(c);
    return vars as CSSProperties;
  }, [colors]);

  return { palette, setPalette, colors, roleVars };
}
