'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ArtService, ArtSpec } from '../lib/art';

export const ArtContext = createContext<ArtService | null>(null);
export const useArtService = () => useContext(ArtContext);

/**
 * A rendered illustration of a structure (see ArtService). Waits until it scrolls into view before asking for
 * the render, and shows a lettered placeholder until the image is ready.
 */
export function Art({ spec, label, className }: { spec: ArtSpec; label: string; className?: string }) {
  const svc = useArtService();
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(() => svc?.peek(spec) ?? null);
  const [seen, setSeen] = useState(false);
  const key = `${spec.kind}:${spec.id}`;

  useEffect(() => {
    setUrl(svc?.peek(spec) ?? null);
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, svc]);

  useEffect(() => {
    if (!svc || !seen) return;
    let alive = true;
    svc.get(spec).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, seen, key]);

  return (
    <span ref={ref} className={`art ${className ?? ''}`}>
      {url ? <img src={url} alt="" /> : <span className="art-fallback" aria-hidden>{label.charAt(0)}</span>}
    </span>
  );
}
