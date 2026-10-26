'use client';

import dynamic from 'next/dynamic';

// WebGL needs the browser; load the app on the client only.
const PhysioApp = dynamic(() => import('./PhysioApp'), {
  ssr: false,
  loading: () => <div className="boot">Loading atlas…</div>,
});

export default function PhysioShell() {
  return <PhysioApp />;
}
