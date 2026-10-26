import { useId } from 'react';
import type { TissueKind } from '../lib/data/learning';

/**
 * Hand-drawn schematic illustrations of the four tissues, in the atlas palette.
 * Each is a 200 × 200 SVG; nothing here is a micrograph.
 */
export default function TissueArt({ kind }: { kind: TissueKind }) {
  const uid = useId().replace(/:/g, '');
  const common = { viewBox: '0 0 200 200', role: 'img' as const, width: '100%', height: '100%' };
  if (kind === 'muscle') return <Muscle uid={uid} {...common} />;
  if (kind === 'bone') return <BoneTissue uid={uid} {...common} />;
  if (kind === 'disc') return <Disc uid={uid} {...common} />;
  return <Cartilage uid={uid} {...common} />;
}

type P = { uid: string; viewBox: string; role: 'img'; width: string; height: string };

function Muscle({ uid, ...svg }: P) {
  const fibres = [34, 54, 74];
  return (
    <svg {...svg} aria-label="Skeletal muscle fibres and a sarcomere">
      <defs>
        <pattern id={`${uid}s`} width="14" height="20" patternUnits="userSpaceOnUse">
          <rect width="14" height="20" fill="#e9a79c" />
          <rect x="4" width="6" height="20" fill="#c9594b" />
          <rect x="6.6" width="0.8" height="20" fill="#f6d9d2" />
        </pattern>
        <radialGradient id={`${uid}g`} cx="40%" cy="30%"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#f7e3da" /></radialGradient>
      </defs>
      <rect width="200" height="200" rx="26" fill={`url(#${uid}g)`} />
      {/* three fibres, with nuclei at the edge */}
      {fibres.map((y, i) => (
        <g key={y}>
          <rect x="12" y={y - 10} width="176" height="20" rx="10" fill={`url(#${uid}s)`} stroke="#b6483a" strokeWidth="1.2" />
          {[40 + i * 22, 118 + i * 14, 168 - i * 18].map((x) => <ellipse key={x} cx={x} cy={y - 8} rx="6" ry="2.6" fill="#6d4a8f" opacity=".85" />)}
        </g>
      ))}
      {/* sarcomere: Z lines, thin (actin) and thick (myosin) filaments */}
      <g transform="translate(0 112)">
        {[30, 100, 170].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="70" stroke="#5b524b" strokeWidth="3" />)}
        {[0, 1].map((k) => {
          const x0 = 30 + k * 70;
          return [10, 24, 38, 52, 62].map((y) => (
            <g key={`${k}${y}`}>
              <line x1={x0} y1={y} x2={x0 + 44} y2={y} stroke="#8d6bcc" strokeWidth="2" opacity=".8" />
              <line x1={x0 + 70} y1={y} x2={x0 + 26} y2={y} stroke="#8d6bcc" strokeWidth="2" opacity=".8" />
            </g>
          ));
        })}
        {[0, 1].map((k) => [17, 31, 45, 57].map((y) => <line key={`${k}${y}`} x1={52 + k * 70 - 6} y1={y} x2={52 + k * 70 + 30} y2={y} stroke="#c9594b" strokeWidth="5" strokeLinecap="round" />))}
      </g>
      <text x="100" y="190" textAnchor="middle" fontSize="9" fill="#8d847c" fontFamily="sans-serif" letterSpacing=".1em">FIBRES · SARCOMERE</text>
    </svg>
  );
}

function Osteon({ cx, cy, s = 1, rot = 0 }: { cx: number; cy: number; s?: number; rot?: number }) {
  const rings = [36, 30, 24, 18, 12];
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s}) rotate(${rot})`}>
      {rings.map((r, i) => <circle key={r} r={r} fill={i % 2 ? '#f1e6d2' : '#e3d2b6'} stroke="#b99a78" strokeWidth="1" />)}
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 + rot;
        const r = i % 2 ? 27 : 21;
        return <ellipse key={i} cx={Math.cos(a) * r} cy={Math.sin(a) * r} rx="3.2" ry="1.7" fill="#7a5a43" transform={`rotate(${(a * 180) / Math.PI + 90} ${Math.cos(a) * r} ${Math.sin(a) * r})`} />;
      })}
      <circle r="6" fill="#e8786a" stroke="#b6483a" strokeWidth="1" />
      <circle r="2.4" fill="#fff" opacity=".7" />
    </g>
  );
}

function BoneTissue({ uid, ...svg }: P) {
  return (
    <svg {...svg} aria-label="Compact bone osteons">
      <defs><radialGradient id={`${uid}g`} cx="40%" cy="30%"><stop offset="0" stopColor="#fffaf0" /><stop offset="1" stopColor="#efe0c8" /></radialGradient></defs>
      <rect width="200" height="200" rx="26" fill={`url(#${uid}g)`} />
      {/* interstitial lamellae */}
      {[[100, 100, 70], [100, 100, 56]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="none" stroke="#d9c3a2" strokeWidth="1" strokeDasharray="4 5" />)}
      <Osteon cx={64} cy={62} s={1} rot={10} />
      <Osteon cx={138} cy={58} s={0.8} rot={40} />
      <Osteon cx={100} cy={140} s={1.05} rot={80} />
      <Osteon cx={168} cy={142} s={0.55} rot={0} />
      <Osteon cx={30} cy={148} s={0.55} rot={20} />
      <text x="100" y="192" textAnchor="middle" fontSize="9" fill="#8d847c" fontFamily="sans-serif" letterSpacing=".1em">OSTEONS</text>
    </svg>
  );
}

function Disc({ uid, ...svg }: P) {
  const rings = [84, 74, 64, 54, 44];
  return (
    <svg {...svg} aria-label="Intervertebral disc: annulus fibrosus and nucleus pulposus">
      <defs>
        <radialGradient id={`${uid}g`} cx="40%" cy="30%"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#e4eef2" /></radialGradient>
        <radialGradient id={`${uid}n`} cx="45%" cy="40%"><stop offset="0" stopColor="#d9eef7" /><stop offset="1" stopColor="#7fb1c4" /></radialGradient>
        <clipPath id={`${uid}c`}><ellipse cx="100" cy="100" rx="86" ry="64" /></clipPath>
      </defs>
      <rect width="200" height="200" rx="26" fill={`url(#${uid}g)`} />
      <g clipPath={`url(#${uid}c)`}>
        <ellipse cx="100" cy="100" rx="86" ry="64" fill="#f3e6d3" />
        {rings.map((rx, i) => <ellipse key={rx} cx="100" cy="100" rx={rx} ry={rx * 0.74} fill={i % 2 ? '#ecdcc3' : '#f6ebd9'} stroke="#b99a78" strokeWidth="1" />)}
        {/* collagen fibres alternate direction between layers */}
        {Array.from({ length: 11 }, (_, i) => <line key={`a${i}`} x1={20 + i * 16} y1="30" x2={50 + i * 16} y2="170" stroke="#c4a37f" strokeWidth="1" opacity=".55" />)}
        {Array.from({ length: 11 }, (_, i) => <line key={`b${i}`} x1={20 + i * 16} y1="170" x2={50 + i * 16} y2="30" stroke="#a98763" strokeWidth="1" opacity=".4" />)}
      </g>
      <ellipse cx="100" cy="100" rx="86" ry="64" fill="none" stroke="#a98763" strokeWidth="2" />
      <ellipse cx="100" cy="100" rx="34" ry="25" fill={`url(#${uid}n)`} stroke="#5f93a8" strokeWidth="1.5" />
      <ellipse cx="92" cy="92" rx="10" ry="5" fill="#fff" opacity=".5" />
      <text x="100" y="192" textAnchor="middle" fontSize="9" fill="#8d847c" fontFamily="sans-serif" letterSpacing=".1em">ANNULUS · NUCLEUS</text>
    </svg>
  );
}

function Cartilage({ uid, ...svg }: P) {
  const groups: [number, number, number][] = [[52, 54, 0], [112, 44, 30], [158, 74, -20], [78, 104, 60], [136, 118, 10], [42, 142, -40], [100, 154, 20], [164, 156, 70], [24, 96, 0]];
  return (
    <svg {...svg} aria-label="Hyaline cartilage with chondrocytes">
      <defs>
        <radialGradient id={`${uid}g`} cx="40%" cy="30%"><stop offset="0" stopColor="#f4fbfd" /><stop offset="1" stopColor="#cfe5ee" /></radialGradient>
      </defs>
      <rect width="200" height="200" rx="26" fill={`url(#${uid}g)`} />
      {/* faint collagen network */}
      {Array.from({ length: 14 }, (_, i) => <path key={i} d={`M ${-10 + i * 16} 10 C ${20 + i * 14} 70, ${-10 + i * 18} 130, ${10 + i * 15} 200`} stroke="#a9cbd8" strokeWidth="1" fill="none" opacity=".6" />)}
      {groups.map(([x, y, r], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}>
          <ellipse rx="20" ry="13" fill="#e8f4f8" stroke="#8fb7c7" strokeWidth="1.2" />
          {[-8, 8].map((dx) => (
            <g key={dx}>
              <ellipse cx={dx} rx="7.5" ry="6" fill="#f3b9ae" stroke="#c9594b" strokeWidth="1" />
              <circle cx={dx + 1} cy="-1" r="2.6" fill="#6d4a8f" opacity=".85" />
            </g>
          ))}
        </g>
      ))}
      <text x="100" y="192" textAnchor="middle" fontSize="9" fill="#8d847c" fontFamily="sans-serif" letterSpacing=".1em">CHONDROCYTES IN MATRIX</text>
    </svg>
  );
}
