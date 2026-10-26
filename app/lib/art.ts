import type { Structure } from './types';
import { structureRegion, type SnapshotSpec, type Viewer } from './three/viewer';

export type ArtKind = 'thumb' | 'organ' | 'location';
export interface ArtSpec { kind: ArtKind; id: string }

/** Muscles that sit behind the body's mid-plane are drawn from behind. */
export function isPosterior(s: Structure): boolean {
  const cz = (s.bbox[0][2] + s.bbox[1][2]) / 2;
  const region = structureRegion(s);
  return s.kind === 'muscle' && (region === 'Trunk' || region === 'Head & neck') && cz < 0.03;
}

function snapshotSpec(kind: ArtKind, s: Structure): SnapshotSpec {
  const back = isPosterior(s);
  if (kind === 'thumb') return { ids: [s.id], size: 112, yaw: 18, pitch: 8, fit: 'subject', ghost: 'none', back };
  if (kind === 'organ') return { ids: [s.id], size: 360, yaw: 24, pitch: 10, fit: 'subject', ghost: s.kind === 'muscle' ? 'bones' : 'none', ghostOpacity: 0.2, back };
  return { ids: [s.id], size: 400, yaw: 0, pitch: 0, fit: 'body', ghost: 'bones', ghostOpacity: 0.3, highlight: true, back };
}

/**
 * Generates and caches the artwork. Renders are queued and run one per animation frame so that a long
 * library list never blocks the interface.
 */
export class ArtService {
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private queue: (() => void)[] = [];
  private running = false;

  constructor(private viewer: Viewer, private structures: Map<string, Structure>) {}

  key(spec: ArtSpec) { return `${spec.kind}:${spec.id}`; }
  peek(spec: ArtSpec) { return this.cache.get(this.key(spec)) ?? null; }

  get(spec: ArtSpec): Promise<string> {
    const key = this.key(spec);
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const s = this.structures.get(spec.id);
    if (!s) return Promise.reject(new Error(`no structure ${spec.id}`));
    const p = new Promise<string>((resolve, reject) => {
      this.queue.push(() => {
        try {
          const url = this.viewer.snapshot(snapshotSpec(spec.kind, s));
          this.cache.set(key, url);
          resolve(url);
        } catch (e) { reject(e); }
        this.pending.delete(key);
      });
      this.pump();
    });
    this.pending.set(key, p);
    return p;
  }

  private pump() {
    if (this.running) return;
    this.running = true;
    const step = () => {
      const job = this.queue.shift();
      if (!job) { this.running = false; return; }
      job();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
