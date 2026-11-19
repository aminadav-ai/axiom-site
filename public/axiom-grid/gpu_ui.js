// ============================================================================
// AXIOM-UI UNIFIED 1-DRAW-CALL WEBGL2 SDF & HIDPI FONT ATLAS DRIVER
// Zero DOM Widgets • Zero CSS Layout • Renders Entire App in 1 Instanced Call!
// ============================================================================

const UI_VS = `#version 300 es
precision highp float;

layout(location = 0) in ivec4 a_box;  // w0..w3 (bytes 0..15)
layout(location = 1) in int a_meta;   // w4     (bytes 16..19)
layout(location = 2) in vec4 a_col1;  // w5     (bytes 20..23)
layout(location = 3) in vec4 a_col2;  // w6     (bytes 24..27)
layout(location = 4) in int a_clip;   // w7     (bytes 28..31)

uniform vec2 u_viewSize;

out vec2 v_px;
flat out vec4 v_box;
flat out int v_meta;
flat out int v_clipId;
flat out vec4 v_col1;
flat out vec4 v_col2;
out vec2 v_uv;

void main() {
  int vid = gl_VertexID;
  vec2 corner = vec2(float(vid & 1), float((vid >> 1) & 1));

  int kind = a_meta & 15;
  v_box = vec4(a_box);
  v_meta = a_meta;
  v_clipId = a_clip & 15;
  v_col1 = a_col1;
  v_col2 = a_col2;
  v_uv = corner;

  vec2 pMin;
  vec2 pMax;

  if (kind == 0) {
    float sh = float((a_meta >> 16) & 63);
    float pad = sh + 2.0;
    pMin = v_box.xy - vec2(pad, pad * 0.65);
    pMax = v_box.xy + v_box.zw + vec2(pad, pad * 1.35);
  } else if (kind == 1) {
    float sz = v_box.z * 1.18;
    pMin = vec2(v_box.x - v_box.z * 0.04, v_box.y - v_box.z * 0.08);
    pMax = pMin + vec2(sz, sz);

    int ascii = clamp((a_meta >> 4) & 127, 32, 127) - 32;
    int style = clamp((a_meta >> 12) & 3, 0, 2);
    int col = ascii & 15;
    int row = style * 6 + (ascii >> 4);
    vec2 cellMin = vec2(float(col) / 16.0, float(row) / 18.0);
    vec2 cellMax = cellMin + vec2(1.0 / 16.0, 1.0 / 18.0);
    v_uv = mix(cellMin, cellMax, corner);
  } else if (kind == 2) {
    float r = float((a_meta >> 4) & 255) * 0.5 + 2.0;
    pMin = min(v_box.xy, v_box.zw) - vec2(r);
    pMax = max(v_box.xy, v_box.zw) + vec2(r);
  } else {
    float r = v_box.z + 2.0;
    pMin = v_box.xy - vec2(r);
    pMax = v_box.xy + vec2(r);
  }

  vec2 px = mix(pMin, pMax, corner);
  v_px = px;

  vec2 ndc = vec2(
    (px.x / u_viewSize.x) * 2.0 - 1.0,
    1.0 - (px.y / u_viewSize.y) * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const UI_FS = `#version 300 es
precision highp float;

in vec2 v_px;
flat in vec4 v_box;
flat in int v_meta;
flat in int v_clipId;
flat in vec4 v_col1;
flat in vec4 v_col2;
in vec2 v_uv;

uniform sampler2D u_fontAtlas;
uniform vec4 u_clips[16];

out vec4 fragColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec4 clip = u_clips[v_clipId];
  if (v_px.x < clip.x || v_px.y < clip.y || v_px.x > clip.z || v_px.y > clip.w) {
    discard;
  }

  int kind = v_meta & 15;

  if (kind == 0) {
    vec2 halfSz = v_box.zw * 0.5;
    vec2 center = v_box.xy + halfSz;
    float rad = min(float((v_meta >> 4) & 255), min(halfSz.x, halfSz.y));
    float borderW = float((v_meta >> 12) & 15);
    float shBlur = float((v_meta >> 16) & 63);

    float d = sdRoundBox(v_px - center, halfSz, rad);

    vec4 outPremul = vec4(0.0);
    if (shBlur > 0.5) {
      float dSh = sdRoundBox(v_px - (center + vec2(0.0, shBlur * 0.30)), halfSz, rad);
      float shA = 0.28 * (1.0 - smoothstep(-2.0, shBlur, dSh));
      outPremul = vec4(0.0, 0.0, 0.0, shA);
    }

    float bodyMask = 1.0 - smoothstep(-0.55, 0.55, d);
    if (bodyMask > 0.001) {
      vec4 fillCol = v_col1;
      if (borderW < 0.5 && v_col2.a > 0.001) {
        float tGrad = clamp((v_px.y - v_box.y) / max(v_box.w, 1.0), 0.0, 1.0);
        fillCol = mix(v_col1, v_col2, tGrad);
      }

      vec4 surfCol = fillCol;
      if (borderW > 0.5) {
        float innerMask = 1.0 - smoothstep(-borderW - 0.55, -borderW + 0.55, d);
        surfCol = mix(v_col2, fillCol, innerMask);
      }

      float a = surfCol.a * bodyMask;
      vec4 fg = vec4(surfCol.rgb * a, a);
      outPremul = fg + outPremul * (1.0 - fg.a);
    }

    if (outPremul.a < 0.002) discard;
    fragColor = outPremul;
    return;
  }

  if (kind == 1) {
    float cov = texture(u_fontAtlas, v_uv).a;
    float a = cov * v_col1.a;
    if (a < 0.01) discard;
    fragColor = vec4(v_col1.rgb * a, a);
    return;
  }

  if (kind == 2) {
    float r = float((v_meta >> 4) & 255) * 0.5;
    float d = sdSegment(v_px, v_box.xy, v_box.zw) - r;
    float cov = 1.0 - smoothstep(-0.6, 0.6, d);
    float a = cov * v_col1.a;
    if (a < 0.005) discard;
    fragColor = vec4(v_col1.rgb * a, a);
    return;
  }

  float dist = length(v_px - v_box.xy);
  float outerCov = 1.0 - smoothstep(v_box.z - 0.6, v_box.z + 0.6, dist);
  float innerCut = v_box.w > 0.5 ? smoothstep(v_box.w - 0.6, v_box.w + 0.6, dist) : 1.0;
  float a = outerCov * innerCut * v_col1.a;
  if (a < 0.005) discard;
  fragColor = vec4(v_col1.rgb * a, a);
}`;

function buildFontAtlasTexture(gl) {
  const atlasW = 1024;
  const atlasH = 1152;
  const off = document.createElement('canvas');
  off.width = atlasW;
  off.height = atlasH;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, atlasW, atlasH);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';

  const fonts = [
    '500 42px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    '700 42px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    '500 40px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  ];

  for (let st = 0; st < 3; st++) {
    ctx.font = fonts[st];
    for (let i = 0; i < 96; i++) {
      const ch = String.fromCharCode(32 + i);
      const col = i & 15;
      const row = st * 6 + (i >> 4);
      ctx.fillText(ch, col * 64 + 3, row * 64 + 48);
    }
  }

  const img = ctx.getImageData(0, 0, atlasW, atlasH);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, atlasW, atlasH, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function compileUiProgram(gl) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, UI_VS);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vs));
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, UI_FS);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(fs));
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

const CURSOR_NAMES = ['default', 'pointer', 'text', 'grab', 'nwse-resize', 'ew-resize', 'ns-resize'];

export async function mountAxiomUiApp({ canvas, wasmUrl, fallbackEl, onBadge }) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: false });
  if (!gl) {
    if (fallbackEl) {
      fallbackEl.hidden = false;
      fallbackEl.textContent = 'WebGL2 Required — Enable hardware acceleration to run Axiom-UI.';
    }
    return;
  }

  const resp = await fetch(wasmUrl);
  const buf = await resp.arrayBuffer();
  if (onBadge) onBadge(buf.byteLength);

  const { instance } = await WebAssembly.instantiate(buf, {});
  const ex = instance.exports;

  const prog = compileUiProgram(gl);
  const fontTex = buildFontAtlasTexture(gl);
  const vbo = gl.createBuffer();
  const vao = gl.createVertexArray();

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribIPointer(0, 4, gl.INT, 32, 0);
  gl.vertexAttribDivisor(0, 1);

  gl.enableVertexAttribArray(1);
  gl.vertexAttribIPointer(1, 1, gl.INT, 32, 16);
  gl.vertexAttribDivisor(1, 1);

  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 32, 20);
  gl.vertexAttribDivisor(2, 1);

  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 32, 24);
  gl.vertexAttribDivisor(3, 1);

  gl.enableVertexAttribArray(4);
  gl.vertexAttribIPointer(4, 1, gl.INT, 32, 28);
  gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);

  const locViewSize = gl.getUniformLocation(prog, 'u_viewSize');
  const locFontAtlas = gl.getUniformLocation(prog, 'u_fontAtlas');
  const locClips = gl.getUniformLocation(prog, 'u_clips');
  const clipsFloat = new Float32Array(16 * 4);

  let mx = -1;
  let my = -1;
  let mDown = 0;
  let mClicked = 0;
  let wheelDx = 0;
  let wheelDy = 0;
  let queuedChar = 0;
  let queuedSpecial = 0;

  function getLogicalSize() {
    const w = Math.max(680, Math.round(canvas.clientWidth || window.innerWidth));
    const h = Math.max(560, Math.round(canvas.clientHeight || window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const devW = Math.round(w * dpr);
    const devH = Math.round(h * dpr);
    if (canvas.width !== devW || canvas.height !== devH) {
      canvas.width = devW;
      canvas.height = devH;
    }
    return { w, h };
  }

  const initSz = getLogicalSize();
  ex.init_app(2026, initSz.w, initSz.h);

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mx = Math.round(e.clientX - r.left);
    my = Math.round(e.clientY - r.top);
  });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect();
    mx = Math.round(e.clientX - r.left);
    my = Math.round(e.clientY - r.top);
    mDown = 1;
    mClicked = 1;
  });

  window.addEventListener('pointerup', () => { mDown = 0; });
  window.addEventListener('pointercancel', () => { mDown = 0; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey && Math.abs(e.deltaX) < 1) {
      wheelDx += Math.round(e.deltaY);
    } else {
      wheelDx += Math.round(e.deltaX);
      wheelDy += Math.round(e.deltaY);
    }
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      queuedSpecial = 1;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      queuedSpecial = 2;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      queuedSpecial = 3;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      queuedSpecial = 4;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      queuedSpecial = 5;
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      queuedSpecial = 6;
    } else if (e.key === 'Escape') {
      queuedSpecial = 7;
    } else if (e.key.length === 1) {
      const code = e.key.charCodeAt(0);
      if (code >= 32 && code <= 126) {
        if (code === 32) e.preventDefault();
        queuedChar = code;
      }
    }
  });

  function frame() {
    const { w, h } = getLogicalSize();
    if (ex.on_wheel_x && wheelDx !== 0) ex.on_wheel_x(wheelDx);
    const primCnt = ex.step_ui(w, h, mx, my, mDown, mClicked, wheelDy, queuedChar, queuedSpecial);
    mClicked = 0;
    wheelDx = 0;
    wheelDy = 0;
    queuedChar = 0;
    queuedSpecial = 0;

    const cKind = ex.get_cursor_kind ? ex.get_cursor_kind() : 0;
    const nextCursor = CURSOR_NAMES[cKind] || 'default';
    if (canvas.style.cursor !== nextCursor) canvas.style.cursor = nextCursor;

    const clipsI32 = new Int32Array(ex.memory.buffer, ex.get_clips_byte_offset(), 64);
    for (let i = 0; i < 64; i++) clipsFloat[i] = clipsI32[i];

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(prog);
    gl.uniform2f(locViewSize, w, h);
    gl.uniform4fv(locClips, clipsFloat);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fontTex);
    gl.uniform1i(locFontAtlas, 0);

    if (primCnt > 0) {
      const cmdView = new Int32Array(ex.memory.buffer, ex.get_cmd_byte_offset(), primCnt * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, cmdView, gl.STREAM_DRAW);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, primCnt);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
