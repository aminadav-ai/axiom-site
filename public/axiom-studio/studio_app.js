import { mountStudioGpuCanvas } from './studio_gpu.js';

// Cloud Sandbox Fallback Projects (used on GitHub Pages / axiom-lang.org when local 127.0.0.1:7700 daemon isn't running)
const DEMO_PROJECTS = [
  {
    name: 'axiom-studio',
    path: '/home/aminadav/Projects/axiom-studio',
    files: ['src/studio_core.ax', 'server/src/main.rs', 'web/studio_gpu.js', 'README.md'],
  },
  {
    name: 'axiom-grid',
    path: '/home/aminadav/Projects/axiom-grid',
    files: ['src/grid.ax', 'scripts/verify_grid.mjs', 'README.md'],
  },
  {
    name: 'axiom-workspace',
    path: '/home/aminadav/Projects/axiom-workspace',
    files: ['src/workspace.ax', 'scripts/verify_workspace.mjs', 'README.md'],
  },
  {
    name: 'axiom-lang',
    path: '/home/aminadav/Projects/axiom-lang',
    files: ['examples/payment_demo.ax', 'examples/anti_stub_demo.ax', 'src/strata_wasm.rs'],
  },
];

const DEMO_CODE = `// Axiom Studio v1.0 — Z3-Verified Shekel Budget Kernel
fn remaining_budget_agorot(budget_agorot: i64, spent_agorot: i64) -> i64
  req budget_agorot >= 0 && spent_agorot >= 0
  ens result >= 0 && result <= budget_agorot
{
  if spent_agorot >= budget_agorot {
    0
  } else {
    budget_agorot - spent_agorot
  }
}`;

let isLocalDaemon = false;
let projects = [];
let currentProject = null;
let currentFilePath = '';
let aiMode = 'ultra'; // 'ultra' | 'gemini' | 'ollama'
let spentAgorotTotal = 0;
let chatHistory = [];
let importedSessionId = null;

const daemonBadge = document.getElementById('daemon-badge');
const budgetBadge = document.getElementById('budget-badge');
const projectSelect = document.getElementById('project-select');
const fileListEl = document.getElementById('file-list');
const activeFileLabel = document.getElementById('active-file-label');
const codeEditor = document.getElementById('code-editor');
const planEditor = document.getElementById('plan-editor');
const taskEditor = document.getElementById('task-editor');
const shellOutput = document.getElementById('shell-output');
const chatFeed = document.getElementById('chat-feed');
const chatInput = document.getElementById('chat-input');
const chatModeTitle = document.getElementById('chat-mode-title');
const sessionPill = document.getElementById('session-pill');
const lastCostLabel = document.getElementById('last-cost-label');
const modelSelect = document.getElementById('model-select');

// 1. Mount Hardware WebGL2 Cyrillic+English+₪ Semantic Graph (`studio_core.wasm`)
const gpuCtrl = await mountStudioGpuCanvas({
  canvas: document.getElementById('studio-gpu-canvas'),
  wasmUrl: './studio_core.wasm',
});

function updateBudgetUi() {
  const spentIls = (spentAgorotTotal / 100).toFixed(2);
  const leftIls = Math.max(0, 80 - spentAgorotTotal / 100).toFixed(2);
  budgetBadge.textContent = `Остаток: ${leftIls} ₪ | Расход: ${spentIls} ₪`;
  const modeNum = aiMode === 'ultra' ? 0 : (aiMode === 'gemini' ? 1 : 2);
  if (gpuCtrl) {
    gpuCtrl.setTelemetry(modeNum, 6, 6, spentAgorotTotal, 12);
  }
}

function appendChatMsg(role, text, metaExtra = '') {
  const wrap = document.createElement('div');
  wrap.className = role === 'user' ? 'msg msg-user' : 'msg';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const who = document.createElement('span');
  who.textContent = role === 'user' ? 'Вы (Разработчик)' : 'Axiom Studio Агент';
  const info = document.createElement('span');
  info.textContent = metaExtra;
  meta.append(who, info);

  const body = document.createElement('div');
  body.textContent = text;

  wrap.append(meta, body);
  chatFeed.appendChild(wrap);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

// 2. Dialog Helpers + Safari `closedby="any"` Fallback
function setupLightDismissFallback(dlg) {
  if (!dlg) return;
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dlg.addEventListener('click', (event) => {
      if (event.target !== dlg) return;
      const rect = dlg.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) dlg.close();
    });
  }
}

const dialogImport = document.getElementById('dialog-import');
const dialogKey = document.getElementById('dialog-key');
setupLightDismissFallback(dialogImport);
setupLightDismissFallback(dialogKey);

document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const d = document.getElementById(btn.getAttribute('data-close-dialog'));
    if (d) d.close();
  });
});

// 3. Center Workspace Tabs (`GPU Graph`, `Code Editor`, `Artifacts`)
function switchCenterTab(tabId) {
  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tabId));
  });
  document.getElementById('panel-gpu').hidden = tabId !== 'gpu';
  document.getElementById('panel-code').hidden = tabId !== 'code';
  document.getElementById('panel-artifacts').hidden = tabId !== 'artifacts';
}

document.querySelectorAll('[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => switchCenterTab(btn.getAttribute('data-tab')));
});

// 4. Hybrid AI Mode Switcher (`ultra` | `gemini` | `ollama`)
document.querySelectorAll('[data-ai-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    aiMode = btn.getAttribute('data-ai-mode');
    document.querySelectorAll('[data-ai-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    if (aiMode === 'ultra') {
      chatModeTitle.textContent = 'Чат: Google One Ultra Bridge (0 ₪)';
    } else if (aiMode === 'gemini') {
      chatModeTitle.textContent = `Чат: Автономный агент (${modelSelect.value})`;
    } else {
      chatModeTitle.textContent = 'Чат: Локальная модель Ollama (0 ₪)';
    }
    updateBudgetUi();
  });
});

modelSelect.addEventListener('change', () => {
  if (aiMode === 'gemini') {
    chatModeTitle.textContent = `Чат: Автономный агент (${modelSelect.value})`;
  }
});

// 5. Load Projects & Files
function renderFileList() {
  fileListEl.textContent = '';
  if (!currentProject) return;
  for (const rel of currentProject.files) {
    const li = document.createElement('li');
    li.className = 'file-item mono';
    li.setAttribute('role', 'option');
    const full = `${currentProject.path}/${rel}`;
    li.setAttribute('aria-selected', String(full === currentFilePath));
    li.textContent = rel;
    li.addEventListener('click', () => openFile(full, rel));
    fileListEl.appendChild(li);
  }
}

async function openFile(fullPath, relName) {
  currentFilePath = fullPath;
  activeFileLabel.textContent = relName;
  renderFileList();

  if (!isLocalDaemon) {
    codeEditor.value = DEMO_CODE;
    return;
  }

  const r = await fetch(`/api/file?path=${encodeURIComponent(fullPath)}`);
  const data = await r.json();
  if (data.ok) {
    codeEditor.value = data.content;
    if (fullPath.endsWith('.ax')) {
      await verifyCurrentAxFile(false);
    }
  }
}

async function verifyCurrentAxFile(switchLog = true) {
  if (!isLocalDaemon) {
    shellOutput.textContent =
      '[CLOUD DEMO] Z3 Proved 45/45 obligations in studio_core.ax -> 11.68 KB Wasm (4.43 KB gzip), 0 warnings!\n' +
      'Запустите ./start_studio.sh локально для прямой компиляции файлов на вашем диске.';
    return;
  }

  let target = currentFilePath;
  if (!target.endsWith('.ax') && currentProject) {
    const axRel = currentProject.files.find((f) => f.endsWith('.ax'));
    if (axRel) target = `${currentProject.path}/${axRel}`;
  }
  if (!target.endsWith('.ax')) {
    shellOutput.textContent = 'Выберите файл с расширением .ax для запуска Z3 и компилятора Strata Wasm.';
    return;
  }

  if (switchLog) shellOutput.textContent = `Проверка Z3 и сборка Wasm: ${target} ...`;
  const r = await fetch('/api/axiom/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: target }),
  });
  const d = await r.json();
  shellOutput.textContent =
    `=== AXIOM Z3 & STRATA VERIFIER ===\n` +
    `Файл: ${target}\n` +
    `Статус: ${d.ok ? 'ДОКАЗАНО Z3 (PASS)' : 'ОШИБКА КОНТРАКТА / СИНТАКСИСА'}\n` +
    `${d.output || ''}\n` +
    (d.log_file ? `Лог сохранён: ${d.log_file}` : '');

  if (gpuCtrl && Array.isArray(d.functions) && d.functions.length > 0) {
    const coords = [
      [16, 24], [16, 68], [48, 22], [48, 68], [80, 34], [82, 76],
    ];
    for (let i = 0; i < 6; i++) {
      const fn = d.functions[i % d.functions.length];
      gpuCtrl.setGraphNode(
        i,
        fn.hash24 || 0x768a63,
        d.ok ? 1 : 0,
        fn.cap_mask || 0,
        coords[i][0],
        coords[i][1]
      );
    }
    gpuCtrl.setTelemetry(
      aiMode === 'ultra' ? 0 : (aiMode === 'gemini' ? 1 : 2),
      d.functions.length,
      d.ok ? d.functions.length : 0,
      spentAgorotTotal,
      Math.max(1, Math.round(d.wasm_kb || 15))
    );
  }
}

document.getElementById('btn-verify-ax').addEventListener('click', () => verifyCurrentAxFile(true));

async function saveCurrentFile() {
  if (!isLocalDaemon || !currentFilePath) {
    shellOutput.textContent = '[CLOUD DEMO] Локальное сохранение активно при запуске ./start_studio.sh.';
    return;
  }
  const r = await fetch('/api/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: currentFilePath, content: codeEditor.value }),
  });
  const d = await r.json();
  shellOutput.textContent = d.ok
    ? `Сохранено: ${currentFilePath}`
    : `Ошибка сохранения: ${d.error}`;
}

document.getElementById('btn-save-file').addEventListener('click', saveCurrentFile);
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveCurrentFile();
  }
});

// 6. Antigravity Brain Importer (`~/.gemini/antigravity/brain/*`)
async function importSessionById(sessionId) {
  if (!isLocalDaemon) {
    planEditor.value = '# План внедрения (Демо)\nЗапустите ./start_studio.sh локально для чтения реальной папки ~/.gemini/antigravity/brain/!';
    taskEditor.value = '- [x] Этап 1: axiom-lang\n- [x] Этап 2: axiom-ui\n- [x] Этапы 3-4: axiom-studio';
    appendChatMsg('assistant', 'Демо-сессия загружена! На вашей Linux-машине кнопка «Импорт из Antigravity» читает реальный transcript.jsonl.', 'Antigravity Brain');
    return;
  }

  const r = await fetch('/api/antigravity/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sessionId }),
  });
  const d = await r.json();
  if (!d.ok) return;

  importedSessionId = d.id;
  sessionPill.textContent = `AGY #${d.id.slice(0, 8)}`;
  planEditor.value = d.implementation_plan || '';
  taskEditor.value = d.task_md || '';

  chatFeed.textContent = '';
  chatHistory = [];
  for (const m of d.messages || []) {
    const toolsTxt = Array.isArray(m.tools) && m.tools.length ? ` [${m.tools.join(', ')}]` : '';
    const text = m.content || `(Вызов инструментов:${toolsTxt})`;
    chatHistory.push({ role: m.role, content: text });
    appendChatMsg(m.role, text, `Импорт AGY${toolsTxt}`);
  }

  appendChatMsg(
    'assistant',
    `Сессия Antigravity (${d.id.slice(0, 8)}..., всего шагов: ${d.total_messages}) и русские артефакты implementation_plan.md / task.md успешно перенесены в Axiom Studio! Можем продолжать разработку прямо отсюда.`,
    'Готово к работе'
  );
}

document.getElementById('btn-open-import').addEventListener('click', async () => {
  const listEl = document.getElementById('session-list');
  listEl.textContent = '';

  if (!isLocalDaemon) {
    const li = document.createElement('li');
    li.className = 'session-card';
    li.textContent = 'Демо-сессия Stages 1–4 (Нажмите для загрузки примера)';
    li.addEventListener('click', () => {
      importSessionById('demo');
      dialogImport.close();
    });
    listEl.appendChild(li);
    dialogImport.showModal();
    return;
  }

  const r = await fetch('/api/antigravity/sessions');
  const d = await r.json();
  for (const s of d.sessions || []) {
    const li = document.createElement('li');
    li.className = 'session-card';
    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.textContent = `${s.id.slice(0, 8)}... (${s.message_count} сообщ.) ${s.has_plan ? '[RU План ✓]' : ''}`;
    const sub = document.createElement('div');
    sub.style.fontSize = '0.78rem';
    sub.style.color = 'var(--muted)';
    sub.textContent = s.last_user_prompt || '(без текста)';
    li.append(title, sub);
    li.addEventListener('click', () => {
      importSessionById(s.id);
      dialogImport.close();
    });
    listEl.appendChild(li);
  }
  dialogImport.showModal();
});

// 7. Save GEMINI_API_KEY Modal & Refresh Key Models
document.getElementById('btn-open-key').addEventListener('click', () => {
  dialogKey.showModal();
});

document.getElementById('key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = document.getElementById('key-input').value.trim();
  if (!val || !isLocalDaemon) {
    dialogKey.close();
    return;
  }
  const r = await fetch('/api/config/key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: val }),
  });
  const d = await r.json();
  document.getElementById('key-input').value = '';
  dialogKey.close();
  if (d.ok) {
    appendChatMsg('assistant', 'GEMINI_API_KEY сохранён локально в ~/.env (права 0600). Теперь доступен автономный агент Gemini 4!', 'Безопасность');
  }
});

document.getElementById('btn-refresh-models').addEventListener('click', async () => {
  if (!isLocalDaemon) return;
  const r = await fetch('/api/gemini/models');
  const d = await r.json();
  if (d.ok && Array.isArray(d.models) && d.models.length > 0) {
    const existing = new Set(Array.from(modelSelect.options).map((o) => o.value));
    for (const m of d.models) {
      if (!existing.has(m)) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        modelSelect.appendChild(opt);
      }
    }
    shellOutput.textContent = `Загружено ${d.models.length} активных моделей с вашего ключа Gemini API.`;
  } else {
    shellOutput.textContent = 'Сначала добавьте GEMINI_API_KEY (кнопка «Ключ API»), чтобы запросить список моделей вашего аккаунта.';
  }
});

// 8. Integrated Axiom-Shell Execution
async function runShellCommand(cmd) {
  if (!cmd.trim()) return;
  if (!isLocalDaemon) {
    shellOutput.textContent = `[CLOUD DEMO] $ ${cmd}\nЗапустите ./start_studio.sh на вашем Linux для выполнения реальных системных команд.`;
    return;
  }
  shellOutput.textContent = `$ ${cmd}\nВыполнение...`;
  const r = await fetch('/api/shell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cwd: currentProject ? currentProject.path : '',
      cmd,
    }),
  });
  const d = await r.json();
  shellOutput.textContent = `${d.output || ''}\n[Код возврата: ${d.exit_code} | Лог: ${d.log_file || ''}]`;
}

document.getElementById('shell-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = document.getElementById('shell-input');
  const cmd = inp.value;
  inp.value = '';
  runShellCommand(cmd);
});

document.querySelectorAll('[data-quick-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => runShellCommand(btn.getAttribute('data-quick-cmd')));
});

document.getElementById('btn-copy-agy').addEventListener('click', async () => {
  const cwd = currentProject ? currentProject.path : '/home/aminadav/Projects/axiom-studio';
  const snippet = `cd "${cwd}" && agy`;
  try {
    await navigator.clipboard.writeText(snippet);
  } catch {}
  shellOutput.textContent =
    `=== БЕСПЛАТНЫЙ РЕЖИМ GOOGLE ONE AI ULTRA (0 ₪) ===\n` +
    `Команда скопирована в буфер обмена:\n  ${snippet}\n\n` +
    `Официальный клиент Google Antigravity CLI (agy) и приложение Antigravity легально используют вашу подписку Google One Ultra без расхода API-баланса, а Axiom Studio синхронизирует граф, Z3 и русские артефакты на диске!`;
});

// 9. Hybrid Chat Submission
async function submitChat() {
  const prompt = chatInput.value.trim();
  if (!prompt) return;
  chatInput.value = '';
  appendChatMsg('user', prompt, aiMode.toUpperCase());
  chatHistory.push({ role: 'user', content: prompt });

  if (!isLocalDaemon) {
    appendChatMsg(
      'assistant',
      `[Облачная демо-версия на ${window.location.hostname}]\n` +
        `Локально на вашей машине (/home/aminadav/Projects/axiom-studio/start_studio.sh) этот запрос выполняется в выбранном режиме (${aiMode}): ` +
        `либо за 0 ₪ через синхронизацию Google One Ultra, либо автономным циклом Gemini 4 Carbon с инструментами чтения/записи файлов и Z3!`,
      '0.000 ₪'
    );
    return;
  }

  const sendBtn = document.getElementById('btn-send-chat');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Думаю...';

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: aiMode,
        model: modelSelect.value,
        project_path: currentProject ? currentProject.path : null,
        prompt,
        history: chatHistory,
        imported_plan: planEditor.value,
        imported_task: taskEditor.value,
        antigravity_session_id: importedSessionId,
      }),
    });
    const d = await r.json();
    const costIls = Number(d.cost_ils || 0);
    const agorot = Number(d.cost_agorot || 0);
    spentAgorotTotal += agorot;
    updateBudgetUi();

    const tokInfo = d.input_tokens
      ? `${costIls.toFixed(3)} ₪ (вх: ${d.input_tokens}, кэш: ${d.cached_tokens || 0}, вых: ${d.output_tokens || 0})`
      : '0.000 ₪ (Ultra / Local)';
    lastCostLabel.textContent = `Шаг: ${tokInfo}`;

    let tracePrefix = '';
    if (Array.isArray(d.tool_trace) && d.tool_trace.length > 0) {
      tracePrefix = `[Инструменты: ${d.tool_trace.map((t) => t.tool).join(' -> ')}]\n\n`;
    }
    const fullReply = `${tracePrefix}${d.reply || '(пустой ответ)'}`;
    appendChatMsg('assistant', fullReply, tokInfo);
    chatHistory.push({ role: 'assistant', content: d.reply || '' });
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Отправить';
  }
}

document.getElementById('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitChat();
});

chatInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    submitChat();
  }
});

// Theme Toggle
document.getElementById('btn-theme').addEventListener('click', () => {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
});

// 10. Boot Studio: Detect Local Native Rust Daemon vs Cloud Demo!
async function bootStudio() {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    if (r.ok) {
      const st = await r.json();
      if (st.online) {
        isLocalDaemon = true;
        daemonBadge.textContent = `Демон активен: ${st.rss_mb} МБ ОЗУ (vs 680 МБ Electron)`;
      }
    }
  } catch {
    isLocalDaemon = false;
  }

  if (isLocalDaemon) {
    const pr = await fetch('/api/projects');
    const pd = await pr.json();
    projects = pd.projects || DEMO_PROJECTS;

    // Auto-import the latest Antigravity conversation right on startup!
    const sr = await fetch('/api/antigravity/sessions');
    const sd = await sr.json();
    if (Array.isArray(sd.sessions) && sd.sessions.length > 0) {
      await importSessionById(sd.sessions[0].id);
    }
  } else {
    daemonBadge.textContent = 'Облачная Демо-Песочница (11.68 KB Wasm)';
    projects = DEMO_PROJECTS;
    codeEditor.value = DEMO_CODE;
    appendChatMsg(
      'assistant',
      'Добро пожаловать в Axiom Studio v1.0!\n' +
        '• Слева — проводник всех репозиториев Axiom.\n' +
        '• В центре — аппаратный WebGL2 граф семантических узлов #hash с поддержкой русской кириллицы и символа ₪ в 1 GPU Draw Call.\n' +
        '• Сверху — гибридный переключатель: 1) Google One Ultra (0 ₪), 2) Gemini 4 Carbon API со счётчиком шекелей из бюджета 80 ₪, 3) Ollama Offline.',
      'Гибридная ИИ-Студия'
    );
  }

  projectSelect.textContent = '';
  projects.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = p.name;
    projectSelect.appendChild(opt);
  });

  projectSelect.addEventListener('change', () => {
    currentProject = projects[Number(projectSelect.value)] || projects[0];
    renderFileList();
    if (currentProject && currentProject.files.length > 0) {
      const preferred = currentProject.files.find((f) => f.endsWith('.ax')) || currentProject.files[0];
      openFile(`${currentProject.path}/${preferred}`, preferred);
    }
  });

  currentProject = projects[0];
  renderFileList();
  if (currentProject && currentProject.files.length > 0) {
    const preferred = currentProject.files.find((f) => f.endsWith('.ax')) || currentProject.files[0];
    await openFile(`${currentProject.path}/${preferred}`, preferred);
  }
  updateBudgetUi();
}

bootStudio();
