'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { preferredId, type CatalogItem } from '../lib/catalog';

export default function SearchDialog({ catalog, close, pick }: { catalog: CatalogItem[]; close: () => void; pick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return catalog.slice(0, 40);
    return catalog.filter((c) => c.label.toLowerCase().includes(t) || c.group.toLowerCase().includes(t)).slice(0, 40);
  }, [q, catalog]);
  useEffect(() => setI(0), [q]);

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog" role="dialog" aria-label="Search structures">
        <input ref={input} value={q} placeholder="Search muscles and bones…" aria-label="Search"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(results.length - 1, x + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === 'Enter' && results[i]) pick(preferredId(results[i]));
          }} />
        <ul>
          {results.map((r, n) => (
            <li key={`${r.kind}:${r.key}`} className={n === i ? 'sel' : ''} onMouseEnter={() => setI(n)} onClick={() => pick(preferredId(r))}>
              <span>{r.label}</span><em>{r.kind === 'muscle' ? 'Muscle' : 'Bone'} · {r.group}</em>
            </li>
          ))}
          {results.length === 0 && <li className="empty">No match</li>}
        </ul>
      </div>
    </div>
  );
}
