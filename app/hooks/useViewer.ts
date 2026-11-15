'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Viewer } from '../lib/three/viewer';
import { ArtService } from '../lib/art';
import type { Structure } from '../lib/types';

export interface ViewerCallbacks {
  onSelect?: (id: string | null) => void;
  onHover?: (id: string | null, x: number, y: number) => void;
}

/**
 * Creates the 3D viewer on `canvasRef`'s canvas and loads the models. Safe under StrictMode's double
 * mount: a load that settles after cleanup is ignored and nothing is set after unmount.
 * `viewer` is non-null only once the models are loaded.
 */
export function useViewer(canvasRef: RefObject<HTMLCanvasElement | null>, callbacks: ViewerCallbacks) {
  const viewerRef = useRef<Viewer | null>(null);
  const cbRef = useRef(callbacks);
  useEffect(() => { cbRef.current = callbacks; });

  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [structures, setStructures] = useState<Map<string, Structure>>(() => new Map());
  const [art, setArt] = useState<ArtService | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let v: Viewer;
    try {
      v = new Viewer(canvas, {
        onSelect: (id) => { if (alive) cbRef.current.onSelect?.(id); },
        onHover: (id, x, y) => { if (alive) cbRef.current.onHover?.(id, x, y); },
      });
    } catch {
      setError('WebGL is not available in this browser.');
      return;
    }
    viewerRef.current = v;
    v.load((p) => { if (alive) setProgress(p); }).then(() => {
      if (!alive) return;
      setStructures(new Map(v.structures));
      setArt(new ArtService(v, v.structures));
      setViewer(v);
    }).catch((e: unknown) => {
      if (!alive) return;
      setError(String((e as Error)?.message ?? e));
    });
    return () => {
      alive = false;
      if (viewerRef.current === v) viewerRef.current = null;
      v.dispose();
    };
  }, [canvasRef]);

  return { viewerRef, viewer, ready: viewer !== null, progress, error, structures, art };
}
