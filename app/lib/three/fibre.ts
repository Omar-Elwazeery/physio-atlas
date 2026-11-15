import * as THREE from 'three';
import { MUSCLE_COLOR } from '../kinds';

/**
 * Muscles from Open 3D Model carry a base-colour texture: an atlas of red muscle fibre and white tendon, with each
 * mesh's UVs placing its belly on the fibre and its ends on the tendon. The viewer draws it in two modes:
 *
 *  - natural (`tint` 0): the texture, its fibre region scaled so that its mean colour is MUSCLE_COLOR (the colour the
 *    untextured BodyParts3D muscles are drawn in, so the two sources match side by side); tendon stays as painted;
 *  - tinted (`tint` 1, movement roles, the nerve layer, the ghosted "not involved" grey): the material colour carries
 *    the meaning and the texture only adds its luminance as detail, fibre around the colour itself, tendon as a paler
 *    version of it, so a prime mover reads as red whatever the texture, and its tendon still reads as tendon.
 *
 * Which texels are tendon is read from the texture itself: fibre is saturated (linear max - min about 0.39), tendon
 * nearly grey (0.04-0.15), with the painted transition in between.
 */

/** Mean linear colour and luminance of the fibre and tendon regions of the O3D atlases (measured, see notes). */
const FIBRE_MEAN = new THREE.Vector3(0.543, 0.2, 0.149);
const FIBRE_LUM = 0.27;
const TENDON_LUM = 0.82;

const fibreGain = (() => {
  const c = new THREE.Color(MUSCLE_COLOR); // linear working space
  return new THREE.Vector3(c.r / FIBRE_MEAN.x, c.g / FIBRE_MEAN.y, c.b / FIBRE_MEAN.z);
})();

const PARS = /* glsl */ `
uniform float fibreTint;
uniform vec3 fibreGain;
`;
const MAP = /* glsl */ `
#ifdef USE_MAP
  vec4 texel = texture2D( map, vMapUv );
  float sat = max( texel.r, max( texel.g, texel.b ) ) - min( texel.r, min( texel.g, texel.b ) );
  float tendon = 1.0 - smoothstep( 0.15, 0.32, sat );
  float lum = dot( texel.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 natural = mix( texel.rgb * fibreGain, texel.rgb, tendon );
  float fd = clamp( mix( 1.0, lum / ${FIBRE_LUM.toFixed(3)}, 0.65 ), 0.45, 1.6 );
  float td = clamp( mix( 1.0, lum / ${TENDON_LUM.toFixed(3)}, 0.65 ), 0.6, 1.25 );
  vec3 tinted = mix( diffuseColor.rgb * fd, mix( diffuseColor.rgb, vec3( 1.0 ), 0.35 ) * td, tendon );
  diffuseColor.rgb = mix( diffuseColor.rgb * natural, tinted, fibreTint );
  diffuseColor.a *= texel.a;
#endif
`;

/** A muscle material with a fibre texture. `setFibreTint(mat, on)` switches between the natural and tinted modes. */
export function makeFibreMaterial(map: THREE.Texture, roughness = 0.62): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness, metalness: 0.04, side: THREE.DoubleSide });
  const uniforms = { fibreTint: { value: 0 }, fibreGain: { value: fibreGain } };
  mat.userData.fibre = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${PARS}`)
      .replace('#include <map_fragment>', MAP);
  };
  mat.customProgramCacheKey = () => 'physio-fibre';
  return mat;
}

export const isFibreMaterial = (m: THREE.Material): boolean => !!m.userData.fibre;

/** Natural texture colours (false) or the material colour with the texture as luminance detail (true). */
export function setFibreTint(mat: THREE.MeshStandardMaterial, tinted: boolean) {
  mat.userData.fibre.fibreTint.value = tinted ? 1 : 0;
}

/**
 * Fibre-texture texels wanted per metre of muscle surface: 2500/m is 0.4 mm per texel, finer than the fibre striation
 * painted into the atlases, at the closest zoom the viewer allows (0.25 m).
 */
export const FIBRE_TEXELS_PER_M = 2500;

/**
 * Atlas size (px, square) at which this mesh gets `perM` texels per metre: from the ratio of its UV area to its surface
 * area. The viewer shrinks each atlas to the largest size any of its meshes asks for (powers of two, never up).
 */
export function atlasSizeFor(geom: THREE.BufferGeometry, perM: number): number {
  const p = geom.getAttribute('position'), uv = geom.getAttribute('uv'), index = geom.getIndex();
  if (!uv) return 0;
  let A = 0, U = 0;
  const n = index ? index.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    const i = index ? index.getX(t) : t, j = index ? index.getX(t + 1) : t + 1, k = index ? index.getX(t + 2) : t + 2;
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, j); c.fromBufferAttribute(p, k);
    A += b.sub(a).cross(c.sub(a)).length() / 2;
    U += Math.abs((uv.getX(j) - uv.getX(i)) * (uv.getY(k) - uv.getY(i)) - (uv.getX(k) - uv.getX(i)) * (uv.getY(j) - uv.getY(i))) / 2;
  }
  if (!A || !U) return 0;
  return perM / Math.sqrt(U / A);
}
