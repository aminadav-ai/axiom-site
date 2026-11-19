const canvas = document.getElementById('board-canvas');
const statScore = document.getElementById('stat-score');
const statBest = document.getElementById('stat-best');
const statTurn = document.getElementById('stat-turn');
const statBalls = document.getElementById('stat-balls');
const wasmBadge = document.getElementById('wasm-size-badge');
const toast = document.getElementById('status-toast');
const turnSlider = document.getElementById('turn-slider');
const ttLabel = document.getElementById('tt-label');
const btnNew = document.getElementById('btn-new');
const btnSound = document.getElementById('btn-sound');
const btnUndo = document.getElementById('btn-undo');

// ============================================================================
// GLSL ES 3.00 SHADERS (Studio Gallery Backdrop + Refractive 3D Glass & Marble)
// ============================================================================

const BG_VS = `#version 300 es
precision highp float;
out vec2 v_ndc;
void main() {
  vec2 pos[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  v_ndc = pos[gl_VertexID];
  gl_Position = vec4(v_ndc, 0.9999, 1.0);
}`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform float u_time;
out vec4 fragColor;
void main() {
  float r = length(v_ndc * vec2(0.85, 1.0));
  // Warm museum gallery vignette behind the carved walnut & marble board
  vec3 centerCol = vec3(0.16, 0.14, 0.19) + 0.015 * sin(u_time * 0.7);
  vec3 edgeCol   = vec3(0.05, 0.045, 0.07);
  vec3 col = mix(centerCol, edgeCol, smoothstep(0.15, 1.35, r));
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
uniform int u_board[81];
uniform vec4 u_hopBall; // xyz in meters, w = colorId (0 if inactive)

out vec4 fragColor;

vec3 jewelPigment(int cid) {
  if (cid == 1) return vec3(0.95, 0.10, 0.22); // Ruby
  if (cid == 2) return vec3(0.08, 0.84, 0.34); // Emerald
  if (cid == 3) return vec3(0.14, 0.42, 0.98); // Sapphire
  if (cid == 4) return vec3(0.98, 0.74, 0.09); // Amber Gold
  if (cid == 5) return vec3(0.08, 0.86, 0.94); // Aquamarine
  if (cid == 6) return vec3(0.76, 0.20, 0.98); // Amethyst
  return vec3(0.98, 0.38, 0.08);               // Mandarin Garnet
}

void main() {
  int layer = v_texFlags & 3;
  bool emissive = (v_texFlags & 16) != 0;
  bool useSmooth = (v_texFlags & 32) != 0;
  bool isJewel = (v_texFlags & 64) != 0;

  vec3 V = normalize(u_camPos - v_worldPos);
  vec3 keyDir = normalize(vec3(-0.48, 0.78, 0.40));
  vec3 fillDir = normalize(vec3(0.62, 0.52, -0.58));

  // ==========================================================================
  // 1. TRUE-3D REFRACTIVE GLASS JEWEL SPHERE SHADER (Phong + Caustics + Fresnel)
  // ==========================================================================
  if (isJewel) {
    vec3 N = normalize(v_geomN);
    float ndv = max(dot(N, V), 0.0);

    // Refract view ray into the crystal sphere & sample swirling internal inclusions at 2 depths!
    vec3 refr = refract(-V, N, 0.66);
    vec2 cUv1 = refr.xz * 0.55 + vec2(0.5) + v_uv * 0.25;
    vec2 cUv2 = refr.xy * 0.75 + vec2(0.25, 0.65);
    float swirl1 = texture(u_texArray, vec3(cUv1, 3.0)).a;
    float swirl2 = texture(u_texArray, vec3(cUv2, 3.0)).r;
    float crystalInclusions = mix(0.78, 1.28, swirl1 * 0.6 + swirl2 * 0.4);

    vec3 baseCol = pow(v_colAo.rgb, vec3(2.2));
    // Deep Beer-Lambert jewel absorption: rich dark saturated crystal core!
    vec3 coreBody = baseCol * mix(0.12, 0.58, pow(ndv, 1.25)) * crystalInclusions;

    // Concentrated subsurface caustic crescent ("отлив") on opposite lower hemisphere!
    float backFocus = pow(max(dot(refr, -keyDir), 0.0), 6.5) + 0.35 * pow(max(dot(-N, keyDir), 0.0), 4.5);
    vec3 causticTint = mix(baseCol * 1.4, vec3(1.0, 0.96, 0.85), 0.26);
    vec3 internalCaustic = causticTint * backFocus * 1.55;

    // Crisp Schlick Fresnel glass rim reflection of warm gallery skylight
    float fresnel = 0.03 + 0.72 * pow(1.0 - ndv, 4.6);
    vec3 reflDir = reflect(-V, N);
    vec3 envSky = mix(vec3(0.10, 0.09, 0.14), vec3(0.92, 0.89, 0.84), smoothstep(-0.1, 0.85, reflDir.y));
    vec3 envRefl = mix(baseCol * 0.55, envSky, 0.65) * fresnel * 0.75;

    // Dual mirror-sharp studio softbox specular highlights!
    vec3 H1 = normalize(keyDir + V);
    vec3 H2 = normalize(fillDir + V);
    float specSharp = pow(max(dot(N, H1), 0.0), 160.0) * 2.10;
    float specSoft  = pow(max(dot(N, H1), 0.0), 28.0) * 0.24;
    float specRim   = pow(max(dot(N, H2), 0.0), 56.0) * 0.42;

    // Dynamic glow from nearby pulsing/hopping spheres
    vec3 dynGlow = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      if (i >= u_lightCount) break;
      vec3 toL = u_lightPosRad[i].xyz - v_worldPos;
      float d = length(toL);
      float rad = u_lightPosRad[i].w;
      if (d < rad && d > 0.001) {
        float att = (1.0 - d / rad);
        att *= att;
        dynGlow += u_lightColor[i] * max(dot(N, toL / d), 0.0) * att * 0.55;
      }
    }

    vec3 jewelLinear = coreBody + internalCaustic + envRefl
                     + vec3(1.0, 0.98, 0.94) * (specSharp + specSoft * (0.4 + 0.6 * baseCol))
                     + vec3(0.78, 0.88, 1.0) * specRim
                     + dynGlow * baseCol;

    fragColor = vec4(pow(max(jewelLinear, vec3(0.0)), vec3(1.0 / 2.1)), 1.0);
    return;
  }

  // ==========================================================================
  // 2. EMISSIVE SELECTION HALOS & SHATTERING CRYSTAL SHARDS
  // ==========================================================================
  vec4 texSample = texture(u_texArray, vec3(v_uv, float(layer)));
  vec3 albedo = pow(texSample.rgb * v_colAo.rgb, vec3(2.1));
  float ao = v_colAo.a;

  if (emissive) {
    vec3 glow = pow(v_colAo.rgb, vec3(1.4)) * 1.35;
    fragColor = vec4(glow, 1.0);
    return;
  }

  // ==========================================================================
  // 3. BUMP-MAPPED CARVED MARBLE TILES & BURLED WALNUT CABINET + CAUSTIC SHADOWS
  // ==========================================================================
  vec3 dPdx = dFdx(v_worldPos);
  vec3 dPdy = dFdy(v_worldPos);
  vec3 faceN = normalize(cross(dPdx, dPdy));
  if (dot(faceN, V) < 0.0) faceN = -faceN;
  vec3 baseN = useSmooth ? normalize(v_geomN) : faceN;

  float hC = texSample.a;
  float hU = texture(u_texArray, vec3(v_uv + vec2(1.0 / 256.0, 0.0), float(layer))).a;
  float hV = texture(u_texArray, vec3(v_uv + vec2(0.0, 1.0 / 256.0), float(layer))).a;

  vec2 dUVdx = dFdx(v_uv);
  vec2 dUVdy = dFdy(v_uv);
  vec3 r1 = cross(dPdy, baseN);
  vec3 r2 = cross(baseN, dPdx);
  float det = dot(dPdx, r1);
  float dHdu = (hU - hC) * 3.6;
  float dHdv = (hV - hC) * 3.6;
  float dHdx = dHdu * dUVdx.x + dHdv * dUVdx.y;
  float dHdy = dHdu * dUVdy.x + dHdv * dUVdy.y;
  vec3 surfGrad = sign(det) * (dHdx * r1 + dHdy * r2);
  vec3 N = normalize(max(abs(det), 1e-6) * baseN - surfGrad * 0.22);

  // Analytical Contact Shadow + Translucent Colored Gemstone Caustic Focus on Marble Tiles!
  float contactShadow = 1.0;
  vec3 floorCaustic = vec3(0.0);
  if ((layer == 0 || layer == 1) && v_worldPos.y > 0.16 && abs(v_worldPos.x) < 4.5 && abs(v_worldPos.z) < 4.5) {
    int col = clamp(int(floor(v_worldPos.x + 4.5)), 0, 8);
    int row = clamp(int(floor(v_worldPos.z + 4.5)), 0, 8);
    int cid = u_board[row * 9 + col];
    if (cid > 0) {
      vec2 centerXZ = vec2(-4.0 + float(col), -4.0 + float(row));
      float dBall = length(v_worldPos.xz - centerXZ);
      contactShadow *= mix(0.24, 1.0, smoothstep(0.06, 0.42, dBall));
      // Focused caustic light crescent transmitted through the glass sphere opposite keyDir!
      vec2 causticPos = centerXZ - keyDir.xz * 0.19;
      float dCaus = length(v_worldPos.xz - causticPos);
      floorCaustic += jewelPigment(cid) * exp(-dCaus * dCaus * 34.0) * 1.15;
    }

    // Also cast live moving shadow + colored caustic from the Parabolic Hopping Sphere!
    if (u_hopBall.w > 0.5) {
      int hCid = int(u_hopBall.w + 0.5);
      float hHeight = max(0.0, u_hopBall.y - 0.555);
      vec2 shadowCenter = u_hopBall.xz - keyDir.xz * (0.14 + hHeight * 0.65);
      float dHop = length(v_worldPos.xz - shadowCenter);
      float spread = 0.40 + hHeight * 0.45;
      float dark = mix(0.28, 0.72, clamp(hHeight * 1.4, 0.0, 1.0));
      contactShadow *= mix(dark, 1.0, smoothstep(0.06, spread, dHop));
      floorCaustic += jewelPigment(hCid) * exp(-dHop * dHop * (26.0 / (1.0 + hHeight * 2.0))) * 1.10;
    }
  }

  float ndlKey = max(dot(N, keyDir), 0.0);
  float ndlFill = max(dot(N, fillDir), 0.0);
  vec3 amb = vec3(0.14, 0.14, 0.17) * (0.6 + 0.4 * N.y);
  vec3 diff = amb * ao * contactShadow
            + vec3(1.18, 1.10, 1.00) * ndlKey * contactShadow * ao
            + vec3(0.26, 0.32, 0.44) * ndlFill * ao;

  vec3 Hk = normalize(keyDir + V);
  float polish = (layer == 0 || layer == 1) ? 0.42 : 0.26;
  vec3 spec = vec3(1.0, 0.97, 0.90) * pow(max(dot(N, Hk), 0.0), 54.0) * polish * contactShadow;

  for (int i = 0; i < 24; i++) {
    if (i >= u_lightCount) break;
    vec3 toL = u_lightPosRad[i].xyz - v_worldPos;
    float d = length(toL);
    float rad = u_lightPosRad[i].w;
    if (d < rad && d > 0.001) {
      vec3 L = toL / d;
      float att = 1.0 - d / rad;
      att *= att;
      diff += u_lightColor[i] * max(dot(N, L), 0.0) * att * 0.55;
      vec3 Hl = normalize(L + V);
      spec += u_lightColor[i] * pow(max(dot(N, Hl), 0.0), 40.0) * att * polish * 0.65;
    }
  }

  vec3 lit = albedo * (diff + floorCaustic * 1.4) + spec + floorCaustic * 0.22;
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
// PROCEDURAL GLASS / MARBLE WEB AUDIO SYNTHESIZER ("тык-тык-тык!")
// ============================================================================

let toastTimer = null;
let soundEnabled = true;
let audioCtx = null;
let camParallaxX = 0;
let camParallaxZ = 0;

function ensureAudio() {
  if (!soundEnabled) return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playSfxEvent(ev) {
  if (!ev || !soundEnabled) return;
  const ac = ensureAudio();
  if (!ac) return;
  const now = ac.currentTime;

  if (ev === 1) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.065);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  } else if (ev === 2) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(88, now + 0.11);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } else if (ev >= 10 && ev < 100) {
    const step = ev - 10;
    const baseFreq = Math.min(1420, 540 + step * 36);
    const osc = ac.createOscillator();
    const clickOsc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 1.45, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.65, now + 0.042);

    clickOsc.type = 'sine';
    clickOsc.frequency.setValueAtTime(baseFreq * 2.6, now);
    clickOsc.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.018);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.048);

    osc.connect(gain);
    clickOsc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    clickOsc.start(now);
    osc.stop(now + 0.05);
    clickOsc.stop(now + 0.025);
  } else if (ev >= 200 && ev < 300) {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const t = now + idx * 0.045;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.13, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  } else if (ev === 300) {
    [392, 330, 261.6].forEach((freq, idx) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const t = now + idx * 0.09;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }
}

function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1900);
}

function syncSliderVars() {
  const minVal = Number(turnSlider.min || 0);
  const maxVal = Math.max(minVal + 1, Number(turnSlider.max || 1));
  turnSlider.style.setProperty('--attr-min', String(minVal));
  turnSlider.style.setProperty('--attr-max', String(maxVal));
  turnSlider.style.setProperty('--control-value', String(turnSlider.value));
}

// ============================================================================
// BOOT AXIOM.STRATA + WEBGL2 REFRACTIVE 3D ENGINE
// ============================================================================

async function boot() {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true });
  if (!gl) {
    showToast('WebGL2 Required — Enable hardware acceleration in your browser.');
    return;
  }

  const resp = await fetch('./color_lines.wasm');
  const buf = await resp.arrayBuffer();
  wasmBadge.textContent = `Wasm: ${(buf.byteLength / 1024).toFixed(2)} KB (Zero rustc)`;

  const { instance } = await WebAssembly.instantiate(buf, {});
  const ex = instance.exports;
  ex.init_game(1998);

  const bgProg = compileProgram(gl, BG_VS, BG_FS);
  const worldProg = compileProgram(gl, WORLD_VS, WORLD_FS);
  const emptyVao = gl.createVertexArray();

  // Upload 4 Procedural 256x256 Veined Marble, Burled Walnut & Crystal Textures!
  const texArray = gl.createTexture();
  function uploadTextures() {
    const bytes = new Uint8Array(ex.memory.buffer, ex.get_tex_byte_offset(), 4 * 256 * 256 * 4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texArray);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 256, 256, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
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

  function uploadStaticBoard() {
    const vCnt = ex.get_static_vert_count();
    const view = new Int32Array(ex.memory.buffer, ex.get_static_vbo_byte_offset(), vCnt * 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, staticVbo);
    gl.bufferData(gl.ARRAY_BUFFER, view, gl.STATIC_DRAW);
  }
  uploadStaticBoard();

  const bgTimeLoc = gl.getUniformLocation(bgProg, 'u_time');
  const wLoc = {
    mvp: gl.getUniformLocation(worldProg, 'u_mvp'),
    texArray: gl.getUniformLocation(worldProg, 'u_texArray'),
    camPos: gl.getUniformLocation(worldProg, 'u_camPos'),
    time: gl.getUniformLocation(worldProg, 'u_time'),
    lightCount: gl.getUniformLocation(worldProg, 'u_lightCount'),
    lightPosRad: gl.getUniformLocation(worldProg, 'u_lightPosRad'),
    lightColor: gl.getUniformLocation(worldProg, 'u_lightColor'),
    board: gl.getUniformLocation(worldProg, 'u_board'),
    hopBall: gl.getUniformLocation(worldProg, 'u_hopBall'),
  };

  const lightPosRadFlat = new Float32Array(24 * 4);
  const lightColorFlat = new Float32Array(24 * 3);
  const fovRad = (43 * Math.PI) / 180;
  const camTarget = [0.0, 0.05, -0.36];

  function getCameraEye() {
    return [camParallaxX, 10.15, 7.45 + camParallaxZ];
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(520, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(520, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  let prevScoreSnapshot = 0;

  function renderGpuBoard(timeSec) {
    resizeCanvas();
    const W = canvas.width;
    const H = canvas.height;
    const aspect = W / H;
    const eye = getCameraEye();
    const { fwd, right, up } = buildCameraBasis(eye, camTarget);

    gl.viewport(0, 0, W, H);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 1. Studio Gallery Background Pass
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(bgProg);
    gl.uniform1f(bgTimeLoc, timeSec);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Pack Dynamic Jewel Lights from Axiom.Strata
    const lCnt = Math.min(24, ex.get_light_count());
    const lMem = new Int32Array(ex.memory.buffer, ex.get_lights_byte_offset(), lCnt * 8);
    for (let i = 0; i < lCnt; i++) {
      const b = i * 8;
      lightPosRadFlat[i * 4 + 0] = lMem[b + 0] * 0.001;
      lightPosRadFlat[i * 4 + 1] = lMem[b + 1] * 0.001;
      lightPosRadFlat[i * 4 + 2] = lMem[b + 2] * 0.001;
      lightPosRadFlat[i * 4 + 3] = lMem[b + 3] * 0.001;
      lightColorFlat[i * 3 + 0] = lMem[b + 4] / 255.0;
      lightColorFlat[i * 3 + 1] = lMem[b + 5] / 255.0;
      lightColorFlat[i * 3 + 2] = lMem[b + 6] / 255.0;
    }

    const boardCells = new Int32Array(ex.memory.buffer, ex.get_board_byte_offset(), 81);
    const hopCid = ex.get_hop_active_color();
    const hopVec = [
      ex.get_hop_x() * 0.001,
      ex.get_hop_y() * 0.001,
      ex.get_hop_z() * 0.001,
      hopCid,
    ];

    // 3. Render 3D Carved Marble Board & High-Poly Refractive Glass Jewels
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(worldProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texArray);
    gl.uniform1i(wLoc.texArray, 0);
    gl.uniform3fv(wLoc.camPos, eye);
    gl.uniform1f(wLoc.time, timeSec);
    gl.uniform1i(wLoc.lightCount, lCnt);
    gl.uniform4fv(wLoc.lightPosRad, lightPosRadFlat);
    gl.uniform3fv(wLoc.lightColor, lightColorFlat);
    gl.uniform1iv(wLoc.board, boardCells);
    gl.uniform4fv(wLoc.hopBall, hopVec);

    const proj = mat4Perspective(fovRad, aspect, 0.2, 40.0);
    const view = mat4ViewFromBasis(eye, right, up, fwd);
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
  }

  function refreshHud(syncSliderToCurrent = true) {
    const score = ex.get_score();
    const best = ex.get_high_score();
    const turn = ex.get_turn();
    const maxTurn = ex.get_max_turn();
    const balls = ex.get_balls_count();
    const over = ex.get_game_over();

    if (score > prevScoreSnapshot) {
      showToast(`Line Cleared! +${score - prevScoreSnapshot} Points`);
    }
    prevScoreSnapshot = score;

    statScore.textContent = String(score);
    statBest.textContent = String(best);
    statTurn.textContent = String(turn);
    statBalls.textContent = `${balls} / 81`;

    turnSlider.max = String(Math.max(1, maxTurn));
    if (syncSliderToCurrent) {
      turnSlider.value = String(turn);
    }
    const label = `Turn #${turn} of ${maxTurn}`;
    ttLabel.textContent = label;
    turnSlider.setAttribute('aria-valuetext', label);
    syncSliderVars();

    if (over === 1) {
      showToast(`Board Full! Score: ${score} — Press [R] for New Game or use Turn Slider`);
    }
  }

  // Gentle 3D Camera Parallax on Mouse Move so Specular Highlights Glide Across Glass & Marble!
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    camParallaxX = nx * 0.42;
    camParallaxZ = ny * 0.26;
  });

  // Exact 3D Ray-Plane (`Y = 0.28m`) Intersection for Pixel-Accurate 9x9 Tile Picking!
  canvas.addEventListener('pointerdown', (e) => {
    ensureAudio();
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2.0 - 1.0;
    const ndcY = 1.0 - ((e.clientY - rect.top) / rect.height) * 2.0;

    const aspect = canvas.width / canvas.height;
    const tanHalf = Math.tan(fovRad * 0.5);
    const eye = getCameraEye();
    const { fwd, right, up } = buildCameraBasis(eye, camTarget);

    const rayDir = normalize3([
      fwd[0] + ndcX * aspect * tanHalf * right[0] + ndcY * tanHalf * up[0],
      fwd[1] + ndcX * aspect * tanHalf * right[1] + ndcY * tanHalf * up[1],
      fwd[2] + ndcX * aspect * tanHalf * right[2] + ndcY * tanHalf * up[2],
    ]);

    if (Math.abs(rayDir[1]) < 1e-4) return;
    // Intersect with tile/sphere pick plane Y = 0.28m
    const tHit = (0.28 - eye[1]) / rayDir[1];
    if (tHit <= 0) return;

    const hitX = eye[0] + rayDir[0] * tHit;
    const hitZ = eye[2] + rayDir[2] * tHit;
    const col = Math.floor(hitX + 4.5);
    const row = Math.floor(hitZ + 4.5);
    if (row < 0 || row >= 9 || col < 0 || col >= 9) return;

    const status = ex.click_cell(row, col);
    playSfxEvent(ex.pop_sfx());
    refreshHud(true);

    if (status === 2) {
      showToast('Path Blocked! Spheres need an open orthogonal route.');
    }
  });

  function startNewGame() {
    ensureAudio();
    const seed = (Date.now() & 0x7fffffff) || 1998;
    ex.init_game(seed);
    uploadStaticBoard();
    prevScoreSnapshot = 0;
    toast.hidden = true;
    refreshHud(true);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') {
      e.preventDefault();
      startNewGame();
    } else if ((e.code === 'KeyZ' || e.code === 'Backspace') && ex.is_animating() === 0) {
      const cur = ex.get_turn();
      if (cur > 0) {
        ex.rewind_to_turn(cur - 1);
        prevScoreSnapshot = ex.get_score();
        playSfxEvent(1);
        refreshHud(true);
      }
    }
  });

  btnSound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    btnSound.setAttribute('aria-pressed', String(soundEnabled));
    btnSound.textContent = soundEnabled ? 'Sound: ON' : 'Sound: OFF';
    if (soundEnabled) {
      ensureAudio();
      playSfxEvent(1);
    }
  });

  btnNew.addEventListener('click', startNewGame);

  btnUndo.addEventListener('click', () => {
    if (ex.is_animating() === 1) return;
    const cur = ex.get_turn();
    if (cur > 0) {
      ex.rewind_to_turn(cur - 1);
      prevScoreSnapshot = ex.get_score();
      playSfxEvent(1);
      refreshHud(true);
    }
  });

  turnSlider.addEventListener('input', () => {
    const targetTurn = Number(turnSlider.value);
    ex.rewind_to_turn(targetTurn);
    prevScoreSnapshot = ex.get_score();
    refreshHud(false);
  });

  refreshHud(true);

  function tickFrame(now) {
    ex.step_anim();
    const sfx = ex.pop_sfx();
    if (sfx > 0) playSfxEvent(sfx);
    refreshHud(document.activeElement !== turnSlider);
    renderGpuBoard(now * 0.001);
    requestAnimationFrame(tickFrame);
  }

  requestAnimationFrame(tickFrame);
}

boot();
