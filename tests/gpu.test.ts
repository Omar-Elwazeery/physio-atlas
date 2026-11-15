import { describe, expect, it } from 'vitest';
import { isSoftwareRenderer } from '../app/lib/three/gpu';

describe('isSoftwareRenderer', () => {
  it('recognises the software rasterisers browsers fall back to', () => {
    for (const name of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'Google SwiftShader',
      'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'softpipe',
      'Apple Software Renderer',
    ]) expect(isSoftwareRenderer(name), name).toBe(true);
  });

  it('leaves GPUs, and browsers that hide the name, alone', () => {
    for (const name of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002709) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
      'Apple GPU',
      'Adreno (TM) 740',
      'Mali-G78',
      'WebKit WebGL',
      '',
    ]) expect(isSoftwareRenderer(name), name).toBe(false);
  });
});
