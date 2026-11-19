const canvas = document.getElementById('game-canvas');
const statPenned = document.getElementById('stat-penned');
const statScore = document.getElementById('stat-score');
const statStamina = document.getElementById('stat-stamina');
const statFps = document.getElementById('stat-fps');
const wasmBadge = document.getElementById('wasm-size-badge');
const winBanner = document.getElementById('win-banner');
const winDetail = document.getElementById('win-detail');
const rewindSlider = document.getElementById('rewind-slider');
const ttStatus = document.getElementById('tt-status');
const btnSound = document.getElementById('btn-sound');
const btnRoar = document.getElementById('btn-roar');
const btnReset = document.getElementById('btn-reset');
const btnResume = document.getElementById('btn-resume');

// ============================================================================
// GLSL ES 3.00 SHADERS (Savanna Sunset Sky + Bump-Mapped 3D Flock & Shadows)
// ============================================================================

const SKY_VS = `#version 300 es
precision highp float;
out vec2 v_ndc;
void main() {
  vec2 pos[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  v_ndc = pos[gl_VertexID];
  gl_Position = vec4(v_ndc, 0.9999, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform float u_time;
out vec4 fragColor;

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
    mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  float h = clamp(v_ndc.y * 0.5 + 0.5, 0.0, 1.0);
  // Rich Golden-Hour African Savanna Sky Backdrop
  vec3 horizon = vec3(0.96, 0.72, 0.42);
  vec3 midSky  = vec3(0.32, 0.56, 0.78);
  vec3 zenith  = vec3(0.12, 0.25, 0.48);
  vec3 col = mix(horizon, midSky, smoothstep(0.0, 0.55, h));
  col = mix(col, zenith, smoothstep(0.45, 1.0, h));

  float cloud = noise2(vec2(v_ndc.x * 3.2 + u_time * 0.04, v_ndc.y * 5.0));
  col += vec3(0.98, 0.85, 0.65) * smoothstep(0.56, 0.88, cloud) * (1.0 - h) * 0.25;
  fragColor = vec4(col, 1.0);
}`;

const WORLD_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec4 a_norm;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in int a_texFlags;
layout(location = 4) in vec4 a_colAo;

uniform mat4 u_mvp;

out vec3 v_worldPos;
out vec3 v_geomN;
out vec2 v_uv;
flat out int v_texFlags;
out vec4 v_colAo;

void main() {
  vec3 posMeters = a_pos * 0.001;
  v_worldPos = posMeters;
  v_geomN = normalize(a_norm.xyz - 128.0);
  v_uv = a_uv / 1024.0;
  v_texFlags = a_texFlags;
  v_colAo = a_colAo;
  gl_Position = u_mvp * vec4(posMeters, 1.0);
}`;

const WORLD_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec3 v_worldPos;
in vec3 v_geomN;
in vec2 v_uv;
flat in int v_texFlags;
in vec4 v_colAo;

uniform sampler2DArray u_texArray;
uniform vec3 u_camPos;
uniform float u_time;
uniform int u_lightCount;
uniform vec4 u_lightPosRad[24];
uniform vec3 u_lightColor[24];
uniform vec4 u_shadows[15]; // xyz = worldPos (m), w = radius (m) for Lion + 14 Sheep!

out vec4 fragColor;

void main() {
  int layer = v_texFlags & 7;
  bool emissive = (v_texFlags & 16) != 0;
  bool useSmooth = (v_texFlags & 32) != 0;

  vec4 texSample = texture(u_texArray, vec3(v_uv, float(layer)));
  vec3 albedo = pow(texSample.rgb * v_colAo.rgb, vec3(2.1));
  float ao = v_colAo.a;

  if (emissive) {
    vec3 glow = pow(v_colAo.rgb, vec3(1.3)) * 1.45;
    fragColor = vec4(glow, 1.0);
    return;
  }

  vec3 V = normalize(u_camPos - v_worldPos);
  vec3 dPdx = dFdx(v_worldPos);
  vec3 dPdy = dFdy(v_worldPos);
  vec3 faceN = normalize(cross(dPdx, dPdy));
  if (dot(faceN, V) < 0.0) faceN = -faceN;
  vec3 baseN = useSmooth ? normalize(v_geomN) : faceN;

  // Heightmap Bump Mapping (fluffy Merino wool curls, shaggy lion mane, grass blades, cedar logs!)
  float hC = texSample.a;
  float hU = texture(u_texArray, vec3(v_uv + vec2(1.0 / 256.0, 0.0), float(layer))).a;
  float hV = texture(u_texArray, vec3(v_uv + vec2(0.0, 1.0 / 256.0), float(layer))).a;

  vec2 dUVdx = dFdx(v_uv);
  vec2 dUVdy = dFdy(v_uv);
  vec3 r1 = cross(dPdy, baseN);
  vec3 r2 = cross(baseN, dPdx);
  float det = dot(dPdx, r1);
  float bumpGain = (layer == 4 || layer == 5) ? 4.4 : 3.2;
  float dHdu = (hU - hC) * bumpGain;
  float dHdv = (hV - hC) * bumpGain;
  float dHdx = dHdu * dUVdx.x + dHdv * dUVdx.y;
  float dHdy = dHdu * dUVdy.x + dHdv * dUVdy.y;
  vec3 surfGrad = sign(det) * (dHdx * r1 + dHdy * r2);
  vec3 N = normalize(max(abs(det), 1e-6) * baseN - surfGrad * 0.22);

  // Golden-Hour Savanna Directional Sunlight
  vec3 sunDir = normalize(vec3(-0.42, 0.78, 0.46));

  // Analytical Ground Shadows from Lion, all 14 Sheep, Acacia Canopies & Corral Fence!
  float groundShadow = 1.0;
  if (v_worldPos.y < 0.04) {
    for (int i = 0; i < 15; i++) {
      vec3 cPos = u_shadows[i].xyz;
      float cRad = u_shadows[i].w;
      float lift = max(0.0, cPos.y) + 0.28;
      vec2 projXZ = cPos.xz - sunDir.xz * (lift / sunDir.y);
      float d = length(v_worldPos.xz - projXZ);
      groundShadow = min(groundShadow, mix(0.32, 1.0, smoothstep(cRad * 0.35, cRad * 1.25, d)));
    }

    // Soft dappled canopy shade under the 4 back/side Acacia trees
    vec2 trees[4] = vec2[4](
      vec2(-4.75, -4.55),
      vec2(-4.85,  3.85),
      vec2( 4.65, -4.75),
      vec2(-1.50, -4.90)
    );
    for (int t = 0; t < 4; t++) {
      vec2 tProj = trees[t] - sunDir.xz * (1.85 / sunDir.y);
      float dt = length(v_worldPos.xz - tProj);
      groundShadow = min(groundShadow, mix(0.45, 1.0, smoothstep(0.65, 1.45, dt)));
    }
  }

  float sunNdotL = max(dot(N, sunDir), 0.0);
  vec3 skyAmb = vec3(0.20, 0.24, 0.30) * (0.55 + 0.45 * N.y);
  vec3 totalLight = skyAmb * ao
                  + vec3(1.32, 1.12, 0.84) * sunNdotL * groundShadow * ao;

  // Plush Subsurface Fleece / Fur Rim Halo on Sheep (layer 4) & Lion (layer 5)!
  vec3 rimGlow = vec3(0.0);
  if (layer == 4 || layer == 5) {
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    rimGlow = vec3(1.0, 0.88, 0.65) * rim * 0.26 * (0.4 + 0.6 * max(N.y, 0.0));
  }

  vec3 Hsun = normalize(sunDir + V);
  float specStr = (layer == 7) ? 0.75 : ((layer == 3 || layer == 2) ? 0.18 : 0.08);
  vec3 totalSpec = vec3(1.0, 0.94, 0.82) * pow(max(dot(N, Hsun), 0.0), 36.0) * specStr * groundShadow;

  // Dynamic Point Lights (Shepherd Gate Lanterns & Golden Lion Roar Blast!)
  for (int i = 0; i < 24; i++) {
    if (i >= u_lightCount) break;
    vec3 toL = u_lightPosRad[i].xyz - v_worldPos;
    float d = length(toL);
    float rad = u_lightPosRad[i].w;
    if (d < rad && d > 0.001) {
      vec3 L = toL / d;
      float att = 1.0 - d / rad;
      att *= att;
      totalLight += u_lightColor[i] * max(dot(N, L), 0.0) * att * 0.95;
      vec3 Hl = normalize(L + V);
      totalSpec += u_lightColor[i] * pow(max(dot(N, Hl), 0.0), 28.0) * att * specStr;
    }
  }

  vec3 lit = albedo * totalLight + totalSpec + rimGlow * albedo;
  fragColor = vec4(pow(max(lit, vec3(0.0)), vec3(1.0 / 2.1)), 1.0);
}`;

// ============================================================================
// MATRIX & WEBGL2 HELPERS
// ============================================================================

function mat4Perspective(fovRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovRad * 0.5);
  const nf = 1.0 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function buildCameraBasis(eye, target) {
  const fwd = normalize3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const right = normalize3(cross3(fwd, [0, 1, 0]));
  const up = normalize3(cross3(right, fwd));
  return { fwd, right, up };
}

function mat4ViewFromBasis(eye, right, up, fwd) {
  const bx = -fwd[0], by = -fwd[1], bz = -fwd[2];
  return new Float32Array([
    right[0], up[0], bx, 0,
    right[1], up[1], by, 0,
    right[2], up[2], bz, 0,
    -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]),
    -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]),
    -(bx * eye[0] + by * eye[1] + bz * eye[2]),
    1,
  ]);
}

function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function compileProgram(gl, vsSrc, fsSrc) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vs));
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(fs));
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function setupVao(gl, vbo) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.INT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, false, 32, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.INT, false, 32, 16);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribIPointer(3, 1, gl.INT, 32, 24);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, 32, 28);
  gl.bindVertexArray(null);
  return vao;
}

// ============================================================================
// PROCEDURAL WEB AUDIO SYNTHESIZER (Lion Roar, Sheep Bleat & Shepherd Bell)
// ============================================================================

const keys = new Set();
let roarQueued = 0;
let restartQueued = false;
let ptrActive = 0;
let ptrWx = 512;
let ptrWy = 512;
let scrubbing = false;
let soundEnabled = true;
let audioCtx = null;

function ensureAudio() {
  if (!soundEnabled) return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playLionSfx(ev) {
  if (!ev || !soundEnabled) return;
  const ac = ensureAudio();
  if (!ac) return;
  const now = ac.currentTime;

  if (ev === 1) {
    const osc = ac.createOscillator();
    const sub = ac.createOscillator();
    const filt = ac.createBiquadFilter();
    const gain = ac.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(68, now + 0.36);

    sub.type = 'triangle';
    sub.frequency.setValueAtTime(72, now);
    sub.frequency.exponentialRampToValueAtTime(42, now + 0.38);

    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(680, now);
    filt.frequency.exponentialRampToValueAtTime(220, now + 0.38);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(filt);
    sub.connect(filt);
    filt.connect(gain).connect(ac.destination);
    osc.start(now);
    sub.start(now);
    osc.stop(now + 0.42);
    sub.stop(now + 0.42);
  } else if (ev === 2) {
    const osc = ac.createOscillator();
    const vib = ac.createOscillator();
    const vibGain = ac.createGain();
    const gain = ac.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.linearRampToValueAtTime(315, now + 0.22);

    vib.frequency.setValueAtTime(26, now);
    vibGain.gain.setValueAtTime(18, now);
    vib.connect(vibGain).connect(osc.frequency);

    const filt = ac.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(950, now);
    filt.Q.setValueAtTime(2.5, now);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(filt).connect(gain).connect(ac.destination);

    const bell = ac.createOscillator();
    const bellGain = ac.createGain();
    bell.type = 'sine';
    bell.frequency.setValueAtTime(1318.5, now + 0.04);
    bellGain.gain.setValueAtTime(0.11, now + 0.04);
    bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    bell.connect(bellGain).connect(ac.destination);

    vib.start(now);
    osc.start(now);
    bell.start(now + 0.04);
    vib.stop(now + 0.25);
    osc.stop(now + 0.25);
    bell.stop(now + 0.3);
  } else if (ev === 3) {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      const t = now + i * 0.08;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(g).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }
}

function syncSliderVars() {
  const minVal = Number(rewindSlider.min || 0);
  const maxVal = Math.max(minVal + 1, Number(rewindSlider.max || 1));
  rewindSlider.style.setProperty('--attr-min', String(minVal));
  rewindSlider.style.setProperty('--attr-max', String(maxVal));
  rewindSlider.style.setProperty('--control-value', String(rewindSlider.value));
}

function normalizeKeyTokens(e) {
  const tokens = [];
  if (e.code) tokens.push(e.code);
  if (e.key) {
    if (e.key.startsWith('Arrow')) tokens.push(e.key);
    if (e.key === ' ') tokens.push('Space');
  }
  return tokens;
}

window.addEventListener('keydown', (e) => {
  const toks = normalizeKeyTokens(e);
  if (document.activeElement !== rewindSlider && toks.some((t) => ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(t))) {
    e.preventDefault();
  }
  ensureAudio();
  if (toks.includes('KeyR')) {
    e.preventDefault();
    restartQueued = true;
    return;
  }
  if (toks.includes('Space')) {
    roarQueued = 1;
  }
  toks.forEach((t) => keys.add(t));
}, { capture: true });

window.addEventListener('keyup', (e) => {
  normalizeKeyTokens(e).forEach((t) => keys.delete(t));
}, { capture: true });

window.addEventListener('blur', () => {
  keys.clear();
  ptrActive = 0;
});

function exitScrubMode() {
  scrubbing = false;
  rewindSlider.value = '0';
  rewindSlider.setAttribute('aria-valuetext', 'Live frame (0 snapshots back)');
  ttStatus.textContent = 'Live 3D Simulation';
  btnResume.hidden = true;
  syncSliderVars();
}

// ============================================================================
// BOOT AXIOM.STRATA + WEBGL2 3D SAVANNA ENGINE
// ============================================================================

async function boot() {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true });
  if (!gl) {
    winBanner.hidden = false;
    winDetail.textContent = 'WebGL2 Required — Enable hardware acceleration in your browser.';
    return;
  }

  const resp = await fetch('./lion_herd.wasm');
  const buf = await resp.arrayBuffer();
  wasmBadge.textContent = `Wasm: ${(buf.byteLength / 1024).toFixed(2)} KB (Zero rustc)`;

  const { instance } = await WebAssembly.instantiate(buf, {});
  const ex = instance.exports;
  ex.init_game(2026);

  const skyProg = compileProgram(gl, SKY_VS, SKY_FS);
  const worldProg = compileProgram(gl, WORLD_VS, WORLD_FS);
  const emptyVao = gl.createVertexArray();

  // Upload 8 Procedural 256x256 Grass, Fleece, Mane, Timber & Granite Textures!
  const texArray = gl.createTexture();
  function uploadTextures() {
    const bytes = new Uint8Array(ex.memory.buffer, ex.get_tex_byte_offset(), 8 * 256 * 256 * 4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texArray);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 256, 256, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const maxA = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxA));
    }
  }
  uploadTextures();

  const staticVbo = gl.createBuffer();
  const dynVbo = gl.createBuffer();
  const staticVao = setupVao(gl, staticVbo);
  const dynVao = setupVao(gl, dynVbo);

  function uploadStaticSavanna() {
    const vCnt = ex.get_static_vert_count();
    const view = new Int32Array(ex.memory.buffer, ex.get_static_vbo_byte_offset(), vCnt * 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, staticVbo);
    gl.bufferData(gl.ARRAY_BUFFER, view, gl.STATIC_DRAW);
  }
  uploadStaticSavanna();

  const skyTimeLoc = gl.getUniformLocation(skyProg, 'u_time');
  const wLoc = {
    mvp: gl.getUniformLocation(worldProg, 'u_mvp'),
    texArray: gl.getUniformLocation(worldProg, 'u_texArray'),
    camPos: gl.getUniformLocation(worldProg, 'u_camPos'),
    time: gl.getUniformLocation(worldProg, 'u_time'),
    lightCount: gl.getUniformLocation(worldProg, 'u_lightCount'),
    lightPosRad: gl.getUniformLocation(worldProg, 'u_lightPosRad'),
    lightColor: gl.getUniformLocation(worldProg, 'u_lightColor'),
    shadows: gl.getUniformLocation(worldProg, 'u_shadows'),
  };

  const lightPosRadFlat = new Float32Array(24 * 4);
  const lightColorFlat = new Float32Array(24 * 3);
  const shadowFlat = new Float32Array(15 * 4);

  // Elevated 45-degree 3D Isometric-Perspective Camera aligned with WASD/Arrow directions!
  const fovRad = (42 * Math.PI) / 180;
  const camEye = [7.85, 8.85, 7.85];
  const camTarget = [0.0, -0.15, 0.0];

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(640, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(380, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // Exact 3D Ray-Plane (`Y = 0`) Intersection for Direct Mouse/Touch Meadow Steering!
  function updatePointerMeadowCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2.0 - 1.0;
    const ndcY = 1.0 - ((e.clientY - rect.top) / rect.height) * 2.0;

    const aspect = (canvas.width || 960) / (canvas.height || 580);
    const tanHalf = Math.tan(fovRad * 0.5);
    const { fwd, right, up } = buildCameraBasis(camEye, camTarget);

    const rayDir = normalize3([
      fwd[0] + ndcX * aspect * tanHalf * right[0] + ndcY * tanHalf * up[0],
      fwd[1] + ndcX * aspect * tanHalf * right[1] + ndcY * tanHalf * up[1],
      fwd[2] + ndcX * aspect * tanHalf * right[2] + ndcY * tanHalf * up[2],
    ]);

    if (Math.abs(rayDir[1]) < 1e-4) return;
    const tHit = -camEye[1] / rayDir[1];
    if (tHit <= 0) return;

    const hitX = camEye[0] + rayDir[0] * tHit;
    const hitZ = camEye[2] + rayDir[2] * tHit;
    ptrWx = Math.max(36, Math.min(988, Math.round(hitX * 100 + 512)));
    ptrWy = Math.max(36, Math.min(988, Math.round(hitZ * 100 + 512)));
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    ensureAudio();
    if (e.button === 2) {
      roarQueued = 1;
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    ptrActive = 1;
    updatePointerMeadowCoords(e);
    if (scrubbing) exitScrubMode();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (ptrActive) updatePointerMeadowCoords(e);
  });

  canvas.addEventListener('pointerup', () => { ptrActive = 0; });
  canvas.addEventListener('pointercancel', () => { ptrActive = 0; });

  function renderGpuSavanna() {
    resizeCanvas();
    const W = canvas.width;
    const H = canvas.height;
    const aspect = W / H;
    const timeSec = ex.get_tick() / 60.0;
    const { fwd, right, up } = buildCameraBasis(camEye, camTarget);

    gl.viewport(0, 0, W, H);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 1. Savanna Sunset Sky Backdrop
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(skyProg);
    gl.uniform1f(skyTimeLoc, timeSec);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Pack Dynamic Lights + 15 Animal Shadow Casters from Axiom.Strata!
    const lCnt = Math.min(24, ex.get_light_count());
    const lMem = new Int32Array(ex.memory.buffer, ex.get_lights_byte_offset(), lCnt * 8);
    for (let i = 0; i < lCnt; i++) {
      const b = i * 8;
      const flick = lMem[b + 7] === 1 ? 0.92 + 0.08 * Math.sin(timeSec * 11.0 + i * 2.1) : 1.0;
      lightPosRadFlat[i * 4 + 0] = lMem[b + 0] * 0.001;
      lightPosRadFlat[i * 4 + 1] = lMem[b + 1] * 0.001;
      lightPosRadFlat[i * 4 + 2] = lMem[b + 2] * 0.001;
      lightPosRadFlat[i * 4 + 3] = lMem[b + 3] * 0.001;
      lightColorFlat[i * 3 + 0] = (lMem[b + 4] / 255.0) * flick;
      lightColorFlat[i * 3 + 1] = (lMem[b + 5] / 255.0) * flick;
      lightColorFlat[i * 3 + 2] = (lMem[b + 6] / 255.0) * flick;
    }

    const sMem = new Int32Array(ex.memory.buffer, ex.get_shadows_byte_offset(), 15 * 4);
    for (let i = 0; i < 60; i++) {
      shadowFlat[i] = sMem[i] * 0.001;
    }

    // 3. Render 3D Savanna Plateau, Acacia Trees, Corral & Sculpted 3D Animals!
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(worldProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texArray);
    gl.uniform1i(wLoc.texArray, 0);
    gl.uniform3fv(wLoc.camPos, camEye);
    gl.uniform1f(wLoc.time, timeSec);
    gl.uniform1i(wLoc.lightCount, lCnt);
    gl.uniform4fv(wLoc.lightPosRad, lightPosRadFlat);
    gl.uniform3fv(wLoc.lightColor, lightColorFlat);
    gl.uniform4fv(wLoc.shadows, shadowFlat);

    const proj = mat4Perspective(fovRad, aspect, 0.2, 45.0);
    const view = mat4ViewFromBasis(camEye, right, up, fwd);
    const mvp = mat4Mul(proj, view);
    gl.uniformMatrix4fv(wLoc.mvp, false, mvp);

    gl.bindVertexArray(staticVao);
    gl.drawArrays(gl.TRIANGLES, 0, ex.get_static_vert_count());

    const dynCnt = ex.get_dyn_vert_count();
    if (dynCnt > 0) {
      const dynView = new Int32Array(ex.memory.buffer, ex.get_dyn_vbo_byte_offset(), dynCnt * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, dynVbo);
      gl.bufferData(gl.ARRAY_BUFFER, dynView, gl.STREAM_DRAW);
      gl.bindVertexArray(dynVao);
      gl.drawArrays(gl.TRIANGLES, 0, dynCnt);
    }

    // Sync HUD
    const penned = ex.get_penned();
    const score = ex.get_score();
    const stamina = ex.get_stamina();
    const winTick = ex.get_win_tick();

    statPenned.textContent = `${penned} / 14`;
    statScore.textContent = String(score);
    statStamina.textContent = `${stamina}%`;

    if (winTick > 0) {
      winBanner.hidden = false;
      winDetail.textContent = `Completed in ${(winTick / 60).toFixed(1)}s • Score ${score} • Press [R] for New Flock`;
    } else {
      winBanner.hidden = true;
    }

    const snapCount = Math.max(1, ex.get_snap_count());
    rewindSlider.max = String(Math.max(1, snapCount - 1));
    syncSliderVars();
  }

  function resetFlockNow() {
    ensureAudio();
    exitScrubMode();
    restartQueued = false;
    const seed = (Date.now() & 0x7fffffff) || 424242;
    ex.init_game(seed);
    uploadStaticSavanna();
    renderGpuSavanna();
  }

  btnSound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    btnSound.setAttribute('aria-pressed', String(soundEnabled));
    btnSound.textContent = soundEnabled ? 'Sound: ON' : 'Sound: OFF';
    if (soundEnabled) ensureAudio();
  });

  btnRoar.addEventListener('click', () => {
    ensureAudio();
    if (scrubbing) exitScrubMode();
    roarQueued = 1;
  });

  btnReset.addEventListener('click', resetFlockNow);

  rewindSlider.addEventListener('input', () => {
    const back = Number(rewindSlider.value);
    syncSliderVars();
    if (back === 0) {
      exitScrubMode();
      return;
    }
    scrubbing = true;
    btnResume.hidden = false;
    ex.rewind_to_snapshot(back);
    const rewoundTick = ex.get_tick();
    const label = `Rewound ${back} snapshots to tick #${rewoundTick}`;
    ttStatus.textContent = label;
    rewindSlider.setAttribute('aria-valuetext', label);
    renderGpuSavanna();
  });

  btnResume.addEventListener('click', exitScrubMode);

  renderGpuSavanna();

  let frames = 0;
  let fpsTimer = performance.now();

  function frame(now) {
    if (restartQueued) {
      resetFlockNow();
    } else if (!scrubbing) {
      const right = keys.has('ArrowRight') || keys.has('Numpad6') || keys.has('KeyD') ? 1 : 0;
      const left  = keys.has('ArrowLeft')  || keys.has('Numpad4') || keys.has('KeyA') ? 1 : 0;
      const down  = keys.has('ArrowDown')  || keys.has('Numpad2') || keys.has('KeyS') ? 1 : 0;
      const up    = keys.has('ArrowUp')    || keys.has('Numpad8') || keys.has('KeyW') ? 1 : 0;
      const dx = right - left;
      const dy = down - up;

      ex.step_game(dx, dy, roarQueued, ptrActive, ptrWx, ptrWy);
      roarQueued = 0;
      const sfx = ex.pop_sfx();
      if (sfx > 0) playLionSfx(sfx);
      renderGpuSavanna();
    }

    frames++;
    if (now - fpsTimer >= 500) {
      statFps.textContent = String(Math.round((frames * 1000) / (now - fpsTimer)));
      frames = 0;
      fpsTimer = now;
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

boot();
