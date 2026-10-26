'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { REGIONS, preferredId, type CatalogItem } from '../lib/catalog';
import type { Region, Structure } from '../lib/types';
import type { Layers } from './PhysioApp';
import { Art } from './Art';

interface Props {
  catalog: CatalogItem[];
  layers: Layers;
  setLayers: Dispatch<SetStateAction<Layers>>;
  selected: string | null;
  select: (id: string | null, focus?: boolean) => void;
  hidden: Set<string>;
  setHidden: Dispatch<SetStateAction<Set<string>>>;
  structures: Map<string, Structure>;
}

export default function ExplorePanel({ catalog, layers, setLayers, selected, select, hidden, setHidden }: Props) {
  const [kind, setKind] = useState<'muscle' | 'bone'>('muscle');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const set = <K extends keyof Layers>(k: K, v: Layers[K]) => setLayers((l) => ({ ...l, [k]: v }));

  const tree = useMemo(() => {
    const out = new Map<Region, Map<string, CatalogItem[]>>();
    for (const it of catalog) {
      if (it.kind !== kind) continue;
      if (!out.has(it.region)) out.set(it.region, new Map());
      const g = out.get(it.region)!;
      if (!g.has(it.group)) g.set(it.group, []);
      g.get(it.group)!.push(it);
    }
    return out;
  }, [catalog, kind]);

  const toggleRegion = (r: Region) => setLayers((l) => {
    const cur = l.regions ?? REGIONS;
    const next = cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r];
    return { ...l, regions: next.length === REGIONS.length ? null : next };
  });

  const selIds = new Set(selected ? [selected] : []);
  const toggleHide = (it: CatalogItem) => setHidden((h) => {
    const n = new Set(h);
    const ids = Object.values(it.ids);
    const all = ids.every((i) => n.has(i));
    for (const i of ids) all ? n.delete(i) : n.add(i);
    return n;
  });

  return (
    <div className="panel">
      <section>
        <h2>Layers</h2>
        <div className="chips">
          {([['bones', 'Skeleton'], ['muscles', 'Muscles'], ['discs', 'Discs'], ['cartilage', 'Cartilage']] as const).map(([k, l]) => (
            <label key={k} className={`chip ${layers[k] ? 'on' : ''}`}>
              <input type="checkbox" checked={layers[k]} onChange={(e) => set(k, e.target.checked)} />{l}
            </label>
          ))}
        </div>
        <label className="row">Muscle opacity
          <input type="range" min={0} max={1} step={0.05} value={layers.muscleOpacity} onChange={(e) => set('muscleOpacity', +e.target.value)} />
        </label>
        <label className="row">Skeleton opacity
          <input type="range" min={0} max={1} step={0.05} value={layers.boneOpacity} onChange={(e) => set('boneOpacity', +e.target.value)} />
        </label>
        <div className="seg" role="group" aria-label="Side">
          {([['both', 'Both'], ['l', 'Left'], ['r', 'Right']] as const).map(([v, l]) => (
            <button key={v} className={layers.side === v ? 'on' : ''} onClick={() => set('side', v)}>{l}</button>
          ))}
        </div>
        <div className="chips">
          {REGIONS.map((r) => (
            <button key={r} className={`chip ${!layers.regions || layers.regions.includes(r) ? 'on' : ''}`} onClick={() => toggleRegion(r)}>{r}</button>
          ))}
        </div>
        <label className="chip check"><input type="checkbox" checked={layers.isolate} onChange={(e) => set('isolate', e.target.checked)} />
          Isolate selection (ghost the rest)</label>
        {hidden.size > 0 && <button className="link" onClick={() => setHidden(new Set())}>Show all hidden ({hidden.size})</button>}
      </section>

      <section>
        <div className="seg" role="group" aria-label="Structure type">
          <button className={kind === 'muscle' ? 'on' : ''} onClick={() => setKind('muscle')}>Muscles</button>
          <button className={kind === 'bone' ? 'on' : ''} onClick={() => setKind('bone')}>Bones</button>
        </div>
        {REGIONS.filter((r) => tree.has(r)).map((r) => (
          <div key={r} className="tree-region">
            <h3>{r}</h3>
            {[...tree.get(r)!.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([g, items]) => {
              const id = `${kind}:${r}:${g}`;
              const isOpen = open[id] ?? false;
              return (
                <div key={g} className="tree-group">
                  <button className="tree-head" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [id]: !isOpen }))}>
                    <span className={`caret ${isOpen ? 'open' : ''}`}>▸</span>{g}<em>{items.length}</em>
                  </button>
                  {isOpen && (
                    <ul>
                      {items.map((it) => {
                        const isSel = Object.values(it.ids).some((i) => selIds.has(i));
                        const isHidden = Object.values(it.ids).every((i) => hidden.has(i));
                        return (
                          <li key={it.key} className={`${isSel ? 'sel' : ''} ${isHidden ? 'muted' : ''}`}>
                            <span className="glyph"><Art spec={{ kind: 'thumb', id: preferredId(it) }} label={it.label} /></span>
                            <button className="name" onClick={() => select(preferredId(it), true)}>{it.label}</button>
                            {it.ids.l && it.ids.r && (
                              <span className="lr">
                                <button className={selected === it.ids.l ? 'on' : ''} onClick={() => select(it.ids.l!, true)} aria-label={`${it.label} left`}>L</button>
                                <button className={selected === it.ids.r ? 'on' : ''} onClick={() => select(it.ids.r!, true)} aria-label={`${it.label} right`}>R</button>
                              </span>
                            )}
                            <button className="eye" onClick={() => toggleHide(it)} aria-label={isHidden ? 'Show' : 'Hide'} title={isHidden ? 'Show' : 'Hide'}>{isHidden ? '○' : '●'}</button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}
