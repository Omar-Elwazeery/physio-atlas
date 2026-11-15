'use client';

import { useId, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { REGIONS, filterItems, librarySections, preferredId, type CatalogItem } from '../lib/catalog';
import type { Region, Structure } from '../lib/types';
import type { Layers } from '../lib/atlasState';
import { NERVES, filterLabel, musclesOfFilter, nerveOptions, rootOptions, supplyOf, viaNerves, type NerveFilter } from '../lib/nerves';
import { Art } from './Art';
import { KINDS, LAYERS, LIBRARY_TABS, type LibraryTab } from '../lib/kinds';

interface Props {
  catalog: CatalogItem[];
  layers: Layers;
  setLayers: Dispatch<SetStateAction<Layers>>;
  selected: string | null;
  select: (id: string | null, focus?: boolean) => void;
  hidden: Set<string>;
  setHidden: Dispatch<SetStateAction<Set<string>>>;
  structures: Map<string, Structure>;
  nerveFilter: NerveFilter | null;
  setNerveFilter: (f: NerveFilter | null) => void;
}

const NERVE_GROUPS = { peripheral: 'Peripheral nerves', cranial: 'Cranial nerves and branches', rami: 'Spinal rami (segmental)' } as const;
const ROOT_GROUPS = [['C', 'Cervical'], ['T', 'Thoracic'], ['L', 'Lumbar'], ['S', 'Sacral']] as const;

export default function ExplorePanel({ catalog, layers, setLayers, selected, select, hidden, setHidden, nerveFilter, setNerveFilter }: Props) {
  const [kind, setKind] = useState<LibraryTab>('muscle');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const uid = useId();
  const [mode, setMode] = useState<'nerve' | 'root'>('nerve');
  const by = nerveFilter?.by ?? mode;
  const nerves = useMemo(() => nerveOptions(), []);
  const roots = useMemo(() => rootOptions(), []);
  const supplied = useMemo(() => {
    if (!nerveFilter) return [];
    const keys = new Set(musclesOfFilter(nerveFilter));
    return catalog.filter((it) => it.kind === 'muscle' && keys.has(it.key));
  }, [catalog, nerveFilter]);
  const set = <K extends keyof Layers>(k: K, v: Layers[K]) => setLayers((l) => ({ ...l, [k]: v }));

  // The library tab's items, narrowed by the filter box when it has text (`filtering`).
  const { listed, filtering } = useMemo(() => {
    const inTab = catalog.filter((it) => KINDS[it.kind].library === kind);
    const found = filterItems(inTab, query);
    return { listed: found ?? inTab, filtering: found !== null };
  }, [catalog, kind, query]);
  const tree = useMemo(() => {
    const out = new Map<Region, Map<string, CatalogItem[]>>();
    for (const it of listed) {
      if (!out.has(it.region)) out.set(it.region, new Map());
      const g = out.get(it.region)!;
      if (!g.has(it.group)) g.set(it.group, []);
      g.get(it.group)!.push(it);
    }
    return out;
  }, [listed]);

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

  const tabLabel = kind === 'joint' ? 'joint structures' : kind === 'bone' ? 'bones' : 'muscles';
  const toggle = (id: string, isOpen: boolean) => setOpen((o) => ({ ...o, [id]: !isOpen }));
  const holdsSel = (items: CatalogItem[]) => !!selected && items.some((it) => Object.values(it.ids).includes(selected));
  const row = (it: CatalogItem) => {
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
  };

  return (
    <div className="panel">
      <section>
        <h2>Layers</h2>
        <div className="chips">
          {LAYERS.map(({ key: k, label: l, title }) => (
            <label key={k} className={`chip ${layers[k] ? 'on' : ''}`} title={title}>
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

      <section aria-labelledby="nerve-h">
        <h2 id="nerve-h">Nerve supply</h2>
        <div className="seg" role="group" aria-label="Filter muscles by">
          {([['nerve', 'By nerve'], ['root', 'By root level']] as const).map(([v, l]) => (
            <button key={v} aria-pressed={by === v} className={by === v ? 'on' : ''}
              onClick={() => { setMode(v); if (nerveFilter && nerveFilter.by !== v) setNerveFilter(null); }}>{l}</button>
          ))}
        </div>
        <label className="row">{by === 'nerve' ? 'Nerve' : 'Spinal root level'}
          <select className="nerve-select" value={nerveFilter?.by === by ? nerveFilter.id : ''} onChange={(e) => setNerveFilter(e.target.value ? { by, id: e.target.value } : null)}>
            <option value="">{by === 'nerve' ? 'Choose a nerve…' : 'Choose a root level…'}</option>
            {by === 'nerve'
              ? (Object.keys(NERVE_GROUPS) as (keyof typeof NERVE_GROUPS)[]).map((k) => (
                <optgroup key={k} label={NERVE_GROUPS[k]}>
                  {nerves.filter((n) => n.kind === k).map((n) => <option key={n.id} value={n.id}>{n.label} ({n.count})</option>)}
                </optgroup>
              ))
              : ROOT_GROUPS.map(([p, l]) => (
                <optgroup key={p} label={l}>
                  {roots.filter((r) => r.id.startsWith(p)).map((r) => <option key={r.id} value={r.id}>{r.id} ({r.count})</option>)}
                </optgroup>
              ))}
          </select>
        </label>
        <p className="nerve-count" role="status" aria-live="polite" aria-atomic="true">
          {nerveFilter ? `${supplied.length} ${supplied.length === 1 ? 'muscle' : 'muscles'}: ${filterLabel(nerveFilter)}. Highlighted on the model, the others are faded.` : ''}
        </p>
        {nerveFilter && (
          <>
            <button className="link" onClick={() => setNerveFilter(null)}>Clear nerve filter</button>
            <ul className="nerve-list" aria-label={`Muscles supplied: ${filterLabel(nerveFilter)}`}>
              {supplied.map((it) => {
                const all = supplyOf(it.key);
                const sup = nerveFilter.by === 'nerve' ? all : undefined;
                const minor = !!sup?.minor.includes(nerveFilter.id);
                const sensory = nerveFilter.by === 'root' && !!all?.sensoryRoots.includes(nerveFilter.id);
                const via = sup ? viaNerves(sup, nerveFilter.id) : [];
                const isSel = Object.values(it.ids).some((i) => i === selected);
                return (
                  <li key={it.key} className={isSel ? 'sel' : ''}>
                    <button className="name" onClick={() => select(preferredId(it), true)} aria-current={isSel || undefined}>{it.label}</button>
                    {minor && <em title="The innervation text calls this part of the supply small or occasional">minor</em>}
                    {sensory && <em title="This root level reaches the muscle through the cervical plexus and is mainly proprioceptive. The motor supply is the accessory nerve; a motor contribution from these roots is debated">proprioceptive</em>}
                    {via.length > 0 && <em title="Supplied through a branch of this nerve">via {via.map((d) => NERVES.get(d)!.label.toLowerCase()).join(', ')}</em>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section>
        <div className="seg" role="group" aria-label="Structure type">
          {LIBRARY_TABS.map(({ tab, label }) => (
            <button key={tab} className={kind === tab ? 'on' : ''} aria-pressed={kind === tab} onClick={() => setKind(tab)}>{label}</button>
          ))}
        </div>
        <div className="tree-filter">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Filter ${tabLabel}…`}
            aria-label={`Filter the list of ${tabLabel} by name`} autoComplete="off" spellCheck={false} enterKeyHint="search"
            onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} />
          {query && <button onClick={() => setQuery('')} aria-label="Clear the filter" title="Clear the filter">×</button>}
        </div>
        <p className="tree-status" role="status" aria-live="polite" aria-atomic="true">
          {!filtering ? '' : listed.length ? `${listed.length} ${listed.length === 1 ? 'match' : 'matches'} in ${tabLabel}` : `No ${tabLabel} match. Search (Ctrl K) looks through everything.`}
        </p>
        {REGIONS.filter((r) => tree.has(r)).map((r) => (
          <div key={r} className="tree-region">
            <h3>{r}</h3>
            {[...tree.get(r)!.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([g, items], gi) => {
              const id = `${kind}:${r}:${g}`;
              const dom = `${uid}-${REGIONS.indexOf(r)}-${gi}`;
              // A filtered list is short: show the matches of each group at once, without levels to open.
              if (filtering) {
                return (
                  <div key={g} className="tree-group">
                    <h4 className="tree-found" id={`${dom}-h`}>{g}<em>{items.length}</em></h4>
                    <ul aria-labelledby={`${dom}-h`}>{items.map(row)}</ul>
                  </div>
                );
              }
              const isOpen = open[id] ?? false;
              return (
                <div key={g} className="tree-group">
                  <button className="tree-head" aria-expanded={isOpen} aria-controls={isOpen ? `${dom}-b` : undefined} onClick={() => toggle(id, isOpen)}>
                    <span className={`caret ${isOpen ? 'open' : ''}`} aria-hidden>▸</span>{g}{holdsSel(items) && <SelMark />}<em>{items.length}</em>
                  </button>
                  {isOpen && (
                    <div id={`${dom}-b`}>
                      {librarySections(g, items).map((sec, si) => {
                        if (sec.label === null) return <ul key="all" aria-label={g}>{sec.items.map(row)}</ul>;
                        const sid = `${id}:${sec.label}`;
                        const subOpen = open[sid] ?? false;
                        return (
                          <div key={sec.label} className="tree-sub">
                            <button className="tree-head sub" aria-expanded={subOpen} aria-controls={subOpen ? `${dom}-s${si}` : undefined} onClick={() => toggle(sid, subOpen)}>
                              <span className={`caret ${subOpen ? 'open' : ''}`} aria-hidden>▸</span>{sec.label}{holdsSel(sec.items) && <SelMark />}<em>{sec.items.length}</em>
                            </button>
                            {subOpen && <ul id={`${dom}-s${si}`} aria-label={`${g}: ${sec.label}`}>{sec.items.map(row)}</ul>}
                          </div>
                        );
                      })}
                    </div>
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

/** Marks the group that holds the selected structure, so it can be found again in a collapsed list. */
const SelMark = () => <span className="sel-mark"><span className="sr-only"> (holds the selection)</span></span>;
