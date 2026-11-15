'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Viewer } from '../lib/three/viewer';
import type { ActiveMove } from '../lib/roles';
import { PoseController, type Pose } from '../lib/poseController';

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Pose, active movement and range restriction. Animations push every frame straight to the viewer;
 * React state (`pose`) is committed at about 10 Hz during a tween and exactly at its end or when it is
 * interrupted, so the sliders and readouts follow the motion without re-rendering the app every frame.
 *
 * `viewer` is the loaded viewer (null until its rig exists); the pose set before then is applied on load.
 */
export function usePose(viewer: Viewer | null) {
  const [pose, setPose] = useState<Pose>({});
  const [active, setActive] = useState<ActiveMove | null>(null);
  const [restrict, setRestrict] = useState(1);
  const [ctrl] = useState(() => new PoseController({ commit: setPose, reducedMotion: prefersReducedMotion }));

  useEffect(() => {
    ctrl.attach(viewer ? (p) => viewer.setPose(p) : null);
    return () => ctrl.attach(null);
  }, [ctrl, viewer]);
  useEffect(() => () => ctrl.halt(), [ctrl]);

  /** Set one degree of freedom immediately (slider drag). */
  const setDof = useCallback((key: string, value: number, move: ActiveMove | null) => {
    ctrl.set(key, value);
    if (move) setActive(move);
  }, [ctrl]);

  /** Animate any number of pose values to targets over `duration` seconds. */
  const animatePose = useCallback((targets: Pose, duration = 1.1, move?: ActiveMove | null, onDone?: () => void) => {
    if (move) setActive(move);
    ctrl.animate(targets, duration, onDone);
  }, [ctrl]);

  const resetPose = useCallback(() => {
    const zero: Pose = {};
    for (const k of Object.keys(ctrl.getPose())) zero[k] = 0;
    ctrl.animate(zero, 0.7);
    setActive(null);
  }, [ctrl]);

  /** Replace the whole pose immediately (deep links, dev hook). */
  const replacePose = useCallback((p: Pose) => ctrl.replace(p), [ctrl]);
  /** The pose the viewer shows right now, which can be ahead of `pose` during a tween. */
  const currentPose = useCallback(() => ctrl.getPose(), [ctrl]);

  return { pose, active, setActive, restrict, setRestrict, setDof, animatePose, resetPose, replacePose, currentPose };
}
