import gsap from 'gsap';

/** Joint angles in degrees, keyed by `dofKey` (see rig/spec.ts). */
export type Pose = Record<string, number>;

/** `base` with every key of `targets` interpolated from `from` (missing = 0) by `t` in [0, 1]. */
export function lerpPose(from: Pose, base: Pose, targets: Pose, t: number): Pose {
  const next: Pose = { ...base };
  for (const [k, v] of Object.entries(targets)) {
    const a = from[k] ?? 0;
    next[k] = a + (v - a) * t;
  }
  return next;
}

export interface PoseControllerOptions {
  /** Publish a pose to the UI (React state). Throttled to `commitInterval` while a tween runs. */
  commit: (pose: Pose) => void;
  /** Minimum time between commits during a tween, in ms (default 100, i.e. about 10 Hz). */
  commitInterval?: number;
  now?: () => number;
  reducedMotion?: () => boolean;
}

/**
 * Owns the current pose and the tween that animates it, independent of React. During a tween the pose
 * goes straight to the renderer each frame and is committed to the UI at a low rate, plus once when the
 * tween ends or is stopped, so the committed pose always matches what the viewer shows once it is idle.
 */
export class PoseController {
  private pose: Pose = {};
  private sink: ((pose: Pose) => void) | null = null;
  private committed: Pose = this.pose;
  private tween: gsap.core.Tween | null = null;
  private seq = 0;
  private lastCommit = -Infinity;
  private readonly interval: number;
  private readonly now: () => number;

  constructor(private readonly opts: PoseControllerOptions) {
    this.interval = opts.commitInterval ?? 100;
    this.now = opts.now ?? (() => performance.now());
  }

  /** The pose the viewer is showing right now (may be ahead of the committed one during a tween). */
  getPose(): Pose { return this.pose; }
  isAnimating(): boolean { return this.tween !== null; }

  /**
   * Connect the renderer (or disconnect with null). Every pose change, including every animation frame,
   * is pushed to it; on connect it receives the current pose straight away.
   */
  attach(sink: ((pose: Pose) => void) | null) {
    this.sink = sink;
    sink?.(this.pose);
  }

  /** Set one value immediately (slider drag): stops any tween, applies and commits. */
  set(key: string, value: number) {
    this.halt();
    this.write({ ...this.pose, [key]: value });
    this.flush();
  }

  /** Replace the whole pose immediately. */
  replace(pose: Pose) {
    this.halt();
    this.write({ ...pose });
    this.flush();
  }

  /** Animate the keys of `targets` from their current values over `duration` seconds. */
  animate(targets: Pose, duration: number, onDone?: () => void) {
    this.halt();
    this.flush();
    const from = { ...this.pose };
    const token = ++this.seq;
    if (duration <= 0 || this.opts.reducedMotion?.()) {
      this.write(lerpPose(from, this.pose, targets, 1));
      this.flush();
      onDone?.();
      return;
    }
    const proxy = { t: 0 };
    this.lastCommit = this.now();
    this.tween = gsap.to(proxy, {
      t: 1, duration, ease: 'power2.inOut',
      onUpdate: () => {
        if (token !== this.seq) return;
        this.write(lerpPose(from, this.pose, targets, proxy.t));
        if (this.now() - this.lastCommit >= this.interval) this.flush();
      },
      onComplete: () => {
        if (token !== this.seq) return;
        this.tween = null;
        this.flush();
        onDone?.();
      },
    });
  }

  /** Stop any running tween where it is and commit that pose. */
  stop() {
    this.halt();
    this.flush();
  }

  /** Stop any running tween without committing (also used on unmount). The controller stays usable. */
  halt() {
    this.seq++;
    this.tween?.kill();
    this.tween = null;
  }

  private write(p: Pose) {
    this.pose = p;
    this.sink?.(p);
  }

  private flush() {
    if (this.committed === this.pose) return;
    this.committed = this.pose;
    this.lastCommit = this.now();
    this.opts.commit(this.pose);
  }
}
