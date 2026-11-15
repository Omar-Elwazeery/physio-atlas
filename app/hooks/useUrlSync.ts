'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeUrlState, encodeUrlState, type UrlState, type UrlStateInput } from '../lib/urlState';

const WRITE_DELAY = 400;

export const urlFor = (query: string) =>
  `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;

function writeUrl(query: string) {
  if (window.location.search.replace(/^\?/, '') === query) return;
  try {
    window.history.replaceState(null, '', urlFor(query));
  } catch { /* some embedded browsers refuse history updates */ }
}

/**
 * Keeps the query string in sync with the atlas state.
 *
 * - Once `ready` (the manifest is loaded), the current URL is decoded and validated, and `onRestore` is
 *   called once with the result, or with null when the URL carries no usable state.
 * - After that, `state` is written back with `history.replaceState`, debounced, so a running animation
 *   (whose committed pose changes ~10 times a second) only updates the URL when it settles.
 */
export function useUrlSync(opts: {
  ready: boolean;
  isStructure: (id: string) => boolean;
  state: UrlStateInput;
  onRestore: (u: UrlState | null) => void;
}) {
  const { ready, isStructure, state, onRestore } = opts;
  const [hydrated, setHydrated] = useState(false);
  const restored = useRef(false);
  const onRestoreRef = useRef(onRestore);
  useEffect(() => { onRestoreRef.current = onRestore; });

  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    let decoded: UrlState = {};
    try { decoded = decodeUrlState(window.location.search, isStructure); } catch { /* treat as empty */ }
    onRestoreRef.current(Object.keys(decoded).length ? decoded : null);
    setHydrated(true);
  }, [ready, isStructure]);

  const query = useMemo(() => encodeUrlState(state), [state]);

  useEffect(() => {
    if (!hydrated) return;
    const t = window.setTimeout(() => writeUrl(query), WRITE_DELAY);
    return () => window.clearTimeout(t);
  }, [hydrated, query]);

  /** Link to an explicit state (e.g. including the not-yet-committed pose of a running animation). */
  const linkFor = useCallback((s: UrlStateInput) => {
    const q = encodeUrlState(s);
    if (hydrated) writeUrl(q);
    return urlFor(q);
  }, [hydrated]);

  return { hydrated, query, linkFor };
}

/** Copy text to the clipboard, with a fallback for browsers without the async clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
