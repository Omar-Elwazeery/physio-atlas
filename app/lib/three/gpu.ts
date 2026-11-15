/**
 * Whether a WebGL renderer name (UNMASKED_RENDERER_WEBGL) is a software rasteriser: Chrome's SwiftShader fallback,
 * Windows' WARP ("Microsoft Basic Render Driver"), Mesa's llvmpipe / softpipe, Apple's software renderer.
 */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

let software: boolean | null = null;

/**
 * Whether this browser draws WebGL on the CPU. Asked once, on a scratch context that is released straight away (a
 * canvas's own context cannot be asked first: its attributes are fixed when it is created). False when the browser
 * hides the renderer's name or has no WebGL 2.
 */
export function softwareRendering(): boolean {
  if (software !== null) return software;
  software = false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: false });
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      software = isSoftwareRenderer(String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? ''));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL: the viewer reports that itself */ }
  return software;
}
