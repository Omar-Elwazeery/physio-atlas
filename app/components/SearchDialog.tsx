'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDialog } from '../hooks/useDialog';
import { preferredId, type CatalogItem } from '../lib/catalog';
import { getSearchIndex, search } from '../lib/search';
import { KINDS } from '../lib/kinds';

export default function SearchDialog({ catalog, close, pick }: { catalog: CatalogItem[]; close: () => void; pick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useDialog<HTMLDivElement>(close, input);
  const uid = useId();
  const listId = `${uid}-list`;
  const optId = (n: number) => `${uid}-opt-${n}`;

  const index = useMemo(() => getSearchIndex(catalog), [catalog]);
  const results = useMemo(() => search(index, q), [index, q]);
  useEffect(() => setI(0), [q]);

  const active = results.length ? Math.min(i, results.length - 1) : -1;
  useEffect(() => {
    if (active >= 0) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const status = !q.trim() ? '' : results.length === 0 ? 'No results' : `${results.length} ${results.length === 1 ? 'result' : 'results'}`;
  const go = (n: number) => { if (results.length) setI(Math.max(0, Math.min(results.length - 1, n))); };

  // preventDefault on mousedown keeps focus in the input, and stops the browser blurring it to <body> after a backdrop click closes us
  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); close(); } }}>
      <div className="dialog" ref={dialog} role="dialog" aria-modal="true" aria-label="Search structures"
        onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}>
        <input ref={input} value={q} placeholder="Search muscles and bones…" aria-label="Search muscles and bones"
          role="combobox" aria-expanded={results.length > 0} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox"
          aria-activedescendant={active >= 0 ? optId(active) : undefined}
          autoComplete="off" spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); go(active + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); go(active - 1); }
            else if (e.key === 'Home' && !e.shiftKey) { e.preventDefault(); go(0); }
            else if (e.key === 'End' && !e.shiftKey) { e.preventDefault(); go(results.length - 1); }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(preferredId(results[active].item)); }
          }} />
        <div className="dialog-sr" role="status" aria-live="polite" aria-atomic="true">{status}</div>
        <ul id={listId} role="listbox" aria-label="Results">
          {results.map(({ item: r, reason }, n) => (
            <li key={`${r.kind}:${r.key}`} id={optId(n)} role="option" aria-selected={n === active} className={n === active ? 'sel' : ''}
              onMouseMove={() => { if (n !== active) setI(n); }} onClick={() => pick(preferredId(r))}>
              <span className="so-main">
                <span>{r.label}</span>
                {reason && <small className="so-why"><b>{reason.label}:</b> {reason.text}</small>}
              </span>
              <em>{KINDS[r.kind].label} · {r.group}</em>
            </li>
          ))}
          {results.length === 0 && <li className="empty" role="presentation">No match</li>}
        </ul>
      </div>
    </div>
  );
}
