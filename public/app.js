const DEMOS = {
  'axiom-studio': {
    title: 'Axiom Studio v1.0 — Hybrid AI IDE & Multilingual GPU Graph',
    size: '11.68 KB Wasm + 2.5 MB Daemon',
    url: '/axiom-studio/',
    repo: 'https://github.com/aminadav-ai/axiom-studio',
  },
  'axiom-grid': {
    title: 'Axiom Grid v1.0 — 1,000,000-Cell GPU Spreadsheet',
    size: '21.65 KB Wasm (7.93 KB gzip)',
    url: '/axiom-grid/',
    repo: 'https://github.com/aminadav-ai/axiom-grid',
  },
  'axiom-workspace': {
    title: 'Axiom Workspace v1.0 — Multi-Window GPU Desktop OS',
    size: '20.57 KB Wasm (6.84 KB gzip)',
    url: '/axiom-workspace/',
    repo: 'https://github.com/aminadav-ai/axiom-workspace',
  },
  'axiom-capsule-browser': {
    title: 'Axiom Capsule Browser v1.0 — Gatekeeper & HTML Clean-Reader',
    size: '21.21 KB Wasm (7.04 KB gzip)',
    url: '/axiom-capsule-browser/',
    repo: 'https://github.com/aminadav-ai/axiom-capsule-browser',
  },
  'axiom-ui': {
    title: 'Axiom-UI v1.0 — Zero-DOM 1-Draw-Call GPU Widget Gallery',
    size: '15.34 KB Wasm (5.38 KB gzip)',
    url: '/axiom-ui/',
    repo: 'https://github.com/aminadav-ai/axiom-ui',
  },
  'axiom-slipgate': {
    title: 'Axiom Slipgate v2.0 GPU HD — True-3D Polygonal Shooter',
    size: '30.38 KB Wasm (11.66 KB gzip)',
    url: '/axiom-slipgate/',
    repo: 'https://github.com/aminadav-ai/axiom-slipgate',
  },
  'axiom-lion-herd': {
    title: 'Axiom Lion Herd v3.0 GPU HD — True-3D Savanna Shepherd',
    size: '17.87 KB Wasm (7.24 KB gzip)',
    url: '/axiom-lion-herd/',
    repo: 'https://github.com/aminadav-ai/axiom-lion-herd',
  },
  'axiom-color-lines': {
    title: 'Axiom Color Lines 98 v3.0 GPU HD — 3D Refractive Glass Puzzle',
    size: '15.32 KB Wasm (5.82 KB gzip)',
    url: '/axiom-color-lines/',
    repo: 'https://github.com/aminadav-ai/axiom-color-lines',
  },
  'compiler-demo': {
    title: 'Axiom Payment Taint & Security Passport Inspector',
    size: '32.30 KB Wasm (~11.4 KB gzip)',
    url: '/compiler-demo/',
    repo: 'https://github.com/aminadav-ai/axiom-lang',
  },
};

const dialog = document.getElementById('demo-modal');
const frame = document.getElementById('modal-iframe');
const titleEl = document.getElementById('modal-title');
const sizeEl = document.getElementById('modal-size');
const fullLink = document.getElementById('modal-fullscreen');
const repoLink = document.getElementById('modal-repo');
const closeBtn = document.getElementById('modal-close');

function openDemoModal(demoId) {
  const info = DEMOS[demoId];
  if (!info || !dialog) return;
  titleEl.textContent = info.title;
  sizeEl.textContent = info.size;
  fullLink.href = info.url;
  repoLink.href = info.repo;
  frame.src = info.url;
  dialog.showModal();
  frame.focus();
}

document.querySelectorAll('[data-launch-demo]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    openDemoModal(el.getAttribute('data-launch-demo'));
  });
});

if (closeBtn && dialog) {
  closeBtn.addEventListener('click', () => dialog.close());
}

if (dialog) {
  dialog.addEventListener('close', () => {
    frame.src = 'about:blank';
  });

  // Fallback for browsers without native `<dialog closedby="any">` support (e.g. Safari)
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!isDialogContent) {
        dialog.close();
      }
    });
  }
}

// Optional Light / Dark Theme Toggle button in header
const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme');
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = current
      ? (current === 'dark' ? 'light' : 'dark')
      : (sysDark ? 'light' : 'dark');
    root.setAttribute('data-theme', next);
    themeBtn.textContent = next === 'dark' ? 'Light Mode' : 'Dark Mode';
  });
}
