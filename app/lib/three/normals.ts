import * as THREE from 'three';

/**
 * Smooth vertex normals that ignore UV seams. Textured meshes repeat a vertex wherever its texture coordinate
 * changes, and `computeVertexNormals()` would then light the two copies differently (a visible crease along every
 * seam). Here vertices with bit-identical positions (as Draco decodes the copies) share one normal: the area-weighted
 * sum of the faces around the position, the same rule as three.js uses otherwise.
 */
export function computeSeamlessNormals(geom: THREE.BufferGeometry) {
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  const pos = posAttr.array as Float32Array;
  const bits = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);
  const n = posAttr.count;
  const index = geom.getIndex();
  // open-addressing hash of positions -> canonical vertex
  let size = 1;
  while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const canon = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const x = bits[v * 3], y = bits[v * 3 + 1], z = bits[v * 3 + 2];
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    for (;;) {
      const c = table[h];
      if (c < 0) { table[h] = v; canon[v] = v; break; }
      if (bits[c * 3] === x && bits[c * 3 + 1] === y && bits[c * 3 + 2] === z) { canon[v] = c; break; }
      h = (h + 1) & (size - 1);
    }
  }
  const acc = new Float32Array(n * 3);
  const tri = index ? index.count / 3 : n / 3;
  const ix = index ? (index.array as ArrayLike<number>) : null;
  for (let t = 0; t < tri; t++) {
    const a = ix ? ix[t * 3] : t * 3, b = ix ? ix[t * 3 + 1] : t * 3 + 1, c = ix ? ix[t * 3 + 2] : t * 3 + 2;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
    const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    for (const v of [canon[a], canon[b], canon[c]]) { acc[v * 3] += fx; acc[v * 3 + 1] += fy; acc[v * 3 + 2] += fz; }
  }
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const c = canon[v];
    const x = acc[c * 3], y = acc[c * 3 + 1], z = acc[c * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    out[v * 3] = x / l; out[v * 3 + 1] = y / l; out[v * 3 + 2] = z / l;
  }
  geom.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}
