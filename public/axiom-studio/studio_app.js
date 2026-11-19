// Axiom Studio v2.0 — Agent-First Minimalist UI + Persistent Project Conversations + On-Demand WebGL2/Z3 Drawer

const DEMO_PROJECTS = [
  { name: 'axiom-studio', path: '~/Projects/axiom-studio', files: ['src/studio_core.ax', 'server/src/main.rs', 'web/index.html', 'web/styles.css'] },
  { name: 'axiom-lang', path: '~/Projects/axiom-lang', files: ['src/main.rs', 'src/strata_wasm.rs'] },
  { name: 'axiom-site', path: '~/Projects/axiom-site', files: ['public/index.html', 'wrangler.jsonc'] },
  { name: 'axiom-ui', path: '~/Projects/axiom-ui', files: ['src/ui.ax'] },
];

const DEMO_CODE = `// Axiom Studio v2.0 — 11.68 KB Wasm GPU Core
fn pack_rgb(r: Int, g: Int, b: Int) -> Int
    req r >= 0 && r <= 255
    req g >= 0 && g <= 255
    req b >= 0 && b <= 255
{
    return (r * 65536) + (g * 256) + b;
}
`;

// --- DOM References ---
const sidebar = document.getElementById('sidebar');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const btnShowSidebar = document.getElementById('btn-show-sidebar');
const projectsTree = document.getElementById('projects-tree');
const projectsCountEl = document.getElementById('projects-count');
const sidebarRamPill = document.getElementById('sidebar-ram-pill');

const crumbProject = document.getElementById('crumb-project');
const crumbTitle = document.getElementById('crumb-title');
const chatScrollWrap = document.getElementById('chat-scroll-wrap');
const chatFeed = document.getElementById('chat-feed');
const btnScrollBottom = document.getElementById('btn-scroll-bottom');

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnSendChat = document.getElementById('btn-send-chat');
const btnStopChat = document.getElementById('btn-stop-chat');
let activeChatAbort = null;
let activeStatusTimer = null;
const btnAttachImage = document.getElementById('btn-attach-image');
const chatImageInput = document.getElementById('chat-image-input');
const composerAttachments = document.getElementById('composer-attachments');
const modelSelect = document.getElementById('model-select');
const costInlinePill = document.getElementById('cost-inline-pill');

const dialogImagePreview = document.getElementById('dialog-image-preview');
const imagePreviewFull = document.getElementById('image-preview-full');
const imagePreviewTitle = document.getElementById('image-preview-title');

const inspectorDrawer = document.getElementById('inspector-drawer');
const btnDrawerArtifacts = document.getElementById('btn-drawer-artifacts');
const btnDrawerTools = document.getElementById('btn-drawer-tools');
const btnCloseDrawer = document.getElementById('btn-close-drawer');

const planEditor = document.getElementById('plan-editor');
const taskEditor = document.getElementById('task-editor');
const fileSelect = document.getElementById('file-select');
const codeEditor = document.getElementById('code-editor');
const shellOutput = document.getElementById('shell-output');
const gpuCanvas = document.getElementById('studio-gpu-canvas');

const dialogSettings = document.getElementById('dialog-settings');
const dialogImport = document.getElementById('dialog-import');
const daemonStatusText = document.getElementById('daemon-status-text');
const budgetDetailText = document.getElementById('budget-detail-text');
const modelsSyncStatus = document.getElementById('models-sync-status');

// --- App State ---
let isLocalDaemon = false;
let projects = [];
let conversations = []; // [{ id, project, title, updated_at, message_count }]
let collapsedProjects = new Set();
let activeProjectName = 'axiom-studio';
let activeConv = null; // { id, project, title, updated_at, messages: [{role, content, meta}], plan_md, task_md }
let currentFilePath = '';
let pendingImages = []; // [{ mime_type, data, name }]
let spentIlsTotal = Number(localStorage.getItem('axiom_studio_spent_ils') || '0');
let gpuBooted = false;
let wasmExports = null;
let wasmMem = null;

// --- Helpers ---
function genConvId() {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatAge(tsSec) {
  if (!tsSec) return '';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (diff < 60) return 'сейчас';
  if (diff < 3600) return `${Math.floor(diff / 60)}м`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч`;
  return `${Math.floor(diff / 86400)}д`;
}

function getProjectByName(name) {
  return projects.find((p) => p.name === name) || projects[0] || { name: 'axiom-studio', path: '', files: [] };
}

function updateBudgetUi() {
  const spent = spentIlsTotal.toFixed(2);
  const rem = Math.max(0, 80 - spentIlsTotal).toFixed(2);
  costInlinePill.textContent = `${spent} ₪`;
  budgetDetailText.textContent = `Бюджет: ${rem} ₪ | Расход: ${spent} ₪`;
  localStorage.setItem('axiom_studio_spent_ils', String(spentIlsTotal));
}

// --- Safe DOM Markdown Renderer (Zero innerHTML!) ---
function appendInlineFormatted(parent, text) {
  const tokenRe = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIdx = 0;
  let match;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parent.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
    }
    const tok = match[0];
    if (tok.startsWith('`')) {
      const code = document.createElement('code');
      code.className = 'md-code-inline';
      code.textContent = tok.slice(1, -1);
      parent.appendChild(code);
    } else if (tok.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = tok.slice(2, -2);
      parent.appendChild(strong);
    }
    lastIdx = tokenRe.lastIndex;
  }
  if (lastIdx < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIdx)));
  }
}

function renderMarkdownSafe(container, rawText) {
  const text = String(rawText || '');
  const parts = text.split(/```(?:[a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const pre = document.createElement('pre');
      pre.className = 'md-pre';
      const code = document.createElement('code');
      code.textContent = parts[i].replace(/\n$/, '');
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }
    const lines = parts[i].split('\n');
    let ul = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        ul = null;
        continue;
      }
      if (/^#{1,4}\s+/.test(trimmed)) {
        ul = null;
        const h = document.createElement('div');
        h.className = 'md-h';
        appendInlineFormatted(h, trimmed.replace(/^#{1,4}\s+/, ''));
        container.appendChild(h);
      } else if (/^([-*•]|\d+\.)\s+/.test(trimmed)) {
        if (!ul) {
          ul = document.createElement('ul');
          ul.className = 'md-ul';
          container.appendChild(ul);
        }
        const li = document.createElement('li');
        appendInlineFormatted(li, trimmed.replace(/^([-*•]|\d+\.)\s+/, ''));
        ul.appendChild(li);
      } else {
        ul = null;
        const p = document.createElement('p');
        p.className = 'md-p';
        appendInlineFormatted(p, trimmed);
        container.appendChild(p);
      }
    }
  }
}

// --- Chat Rendering ---
function scrollToBottom(force = false) {
  if (force || chatScrollWrap.scrollHeight - chatScrollWrap.scrollTop - chatScrollWrap.clientHeight < 140) {
    chatScrollWrap.scrollTop = chatScrollWrap.scrollHeight;
  }
}

chatScrollWrap.addEventListener('scroll', () => {
  const farUp = chatScrollWrap.scrollHeight - chatScrollWrap.scrollTop - chatScrollWrap.clientHeight > 180;
  btnScrollBottom.hidden = !farUp;
});

btnScrollBottom.addEventListener('click', () => scrollToBottom(true));

function renderEmptyWelcome() {
  chatFeed.textContent = '';
  const box = document.createElement('div');
  box.className = 'empty-welcome';

  const img = document.createElement('img');
  img.src = './icons/icon-128.png';
  img.width = 52;
  img.height = 52;
  img.alt = '';

  const h1 = document.createElement('h1');
  h1.textContent = `Проект: ${activeProjectName}`;

  const p = document.createElement('p');
  p.textContent = 'Напишите задачу по-русски. Агент Gemini 4 сам прочитает нужные файлы, внесёт правки и проверит сборку.';

  box.append(img, h1, p);
  chatFeed.appendChild(box);
}

function openImagePreview(src, title = 'Изображение') {
  if (!dialogImagePreview || !imagePreviewFull) return;
  imagePreviewFull.src = src;
  if (imagePreviewTitle) imagePreviewTitle.textContent = title || 'Изображение';
  dialogImagePreview.showModal();
}

function appendMessageEl(role, content, meta = '', images = []) {
  const welcome = chatFeed.querySelector('.empty-welcome');
  if (welcome) welcome.remove();

  const row = document.createElement('div');
  row.className = `msg-row ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (Array.isArray(images) && images.length > 0) {
    const imgGrid = document.createElement('div');
    imgGrid.className = 'msg-images';
    for (const img of images) {
      if (!img || !img.data || !img.mime_type) continue;
      const dataUrl = `data:${img.mime_type};base64,${img.data}`;
      const thumb = document.createElement('img');
      thumb.className = 'msg-image-thumb';
      thumb.src = dataUrl;
      thumb.alt = img.name || 'Прикреплённое изображение';
      thumb.title = `${img.name || 'Изображение'} — нажмите для увеличения`;
      thumb.addEventListener('click', () => openImagePreview(dataUrl, img.name || 'Изображение'));
      imgGrid.appendChild(thumb);
    }
    if (imgGrid.childElementCount > 0) {
      bubble.appendChild(imgGrid);
    }
  }

  if (role === 'user') {
    if (content) {
      const textEl = document.createElement('div');
      textEl.textContent = content;
      bubble.appendChild(textEl);
    }
  } else {
    renderMarkdownSafe(bubble, content);
  }
  row.appendChild(bubble);

  if (meta) {
    const metaEl = document.createElement('div');
    metaEl.className = 'msg-meta mono';
    metaEl.textContent = meta;
    row.appendChild(metaEl);
  }

  chatFeed.appendChild(row);
  scrollToBottom(true);
  return row;
}

function renderActiveConversation() {
  if (!activeConv) {
    renderEmptyWelcome();
    return;
  }
  crumbProject.textContent = activeConv.project;
  crumbTitle.textContent = activeConv.title || 'Новый диалог';
  planEditor.value = activeConv.plan_md || '';
  taskEditor.value = activeConv.task_md || '';

  chatFeed.textContent = '';
  if (!activeConv.messages || activeConv.messages.length === 0) {
    renderEmptyWelcome();
  } else {
    for (const m of activeConv.messages) {
      appendMessageEl(m.role, m.content, m.meta || '', m.images || []);
    }
  }
  syncProjectFilesSelect();
  renderProjectsTree();
}

// --- Conversations Persistence (Local Rust Daemon or Cloud localStorage) ---
function loadCloudConvs() {
  try {
    return JSON.parse(localStorage.getItem('axiom_studio_convs_v2') || '[]');
  } catch {
    return [];
  }
}

function saveCloudConvs(all) {
  localStorage.setItem('axiom_studio_convs_v2', JSON.stringify(all));
}

async function refreshConversationsList() {
  if (isLocalDaemon) {
    try {
      const r = await fetch('/api/conversations', { cache: 'no-store' });
      const d = await r.json();
      conversations = Array.isArray(d.conversations) ? d.conversations : [];
    } catch {
      conversations = [];
    }
  } else {
    conversations = loadCloudConvs().map((c) => ({
      id: c.id,
      project: c.project,
      title: c.title,
      updated_at: c.updated_at,
      message_count: (c.messages || []).length,
    }));
  }
  renderProjectsTree();
}

async function saveActiveConversation() {
  if (!activeConv) return;
  activeConv.updated_at = Math.floor(Date.now() / 1000);
  activeConv.plan_md = planEditor.value;
  activeConv.task_md = taskEditor.value;

  if (isLocalDaemon) {
    await fetch('/api/conversations/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activeConv),
    }).catch(() => {});
  } else {
    const all = loadCloudConvs().filter((c) => c.id !== activeConv.id);
    all.unshift(activeConv);
    saveCloudConvs(all.slice(0, 40));
  }

  const idx = conversations.findIndex((c) => c.id === activeConv.id);
  const summary = {
    id: activeConv.id,
    project: activeConv.project,
    title: activeConv.title,
    updated_at: activeConv.updated_at,
    message_count: activeConv.messages.length,
  };
  if (idx >= 0) conversations.splice(idx, 1);
  conversations.unshift(summary);
  renderProjectsTree();
}

async function openConversationById(id) {
  if (isLocalDaemon) {
    const r = await fetch(`/api/conversations/get?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const d = await r.json();
    if (d.ok && d.conversation) {
      activeConv = d.conversation;
      activeProjectName = activeConv.project || 'axiom-studio';
      collapsedProjects.delete(activeProjectName);
      renderActiveConversation();
    }
  } else {
    const found = loadCloudConvs().find((c) => c.id === id);
    if (found) {
      activeConv = found;
      activeProjectName = activeConv.project || 'axiom-studio';
      renderActiveConversation();
    }
  }
}

async function deleteConversationById(id) {
  if (isLocalDaemon) {
    await fetch('/api/conversations/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  } else {
    saveCloudConvs(loadCloudConvs().filter((c) => c.id !== id));
  }
  conversations = conversations.filter((c) => c.id !== id);
  if (activeConv && activeConv.id === id) {
    startNewConversation(activeProjectName);
  } else {
    renderProjectsTree();
  }
}

function startNewConversation(projectName = activeProjectName) {
  activeProjectName = projectName || 'axiom-studio';
  collapsedProjects.delete(activeProjectName);
  activeConv = {
    id: genConvId(),
    project: activeProjectName,
    title: 'Новый диалог',
    updated_at: Math.floor(Date.now() / 1000),
    messages: [],
    plan_md: '',
    task_md: '',
  };
  renderActiveConversation();
  chatInput.focus();
}

// --- Left Sidebar: Projects -> Nested Conversations Tree ---
function renderProjectsTree() {
  projectsTree.textContent = '';
  projectsCountEl.textContent = String(projects.length);

  for (const proj of projects) {
    const group = document.createElement('div');
    group.className = 'project-group';

    const projConvs = conversations.filter((c) => c.project === proj.name);
    const isCollapsed = collapsedProjects.has(proj.name);

    const row = document.createElement('div');
    row.className = `project-row${proj.name === activeProjectName ? ' active-project' : ''}`;

    const label = document.createElement('span');
    label.className = 'project-label';
    label.textContent = `📁 ${proj.name}`;

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'project-add-btn';
    addBtn.textContent = '+';
    addBtn.title = `Новый диалог в проекте ${proj.name}`;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startNewConversation(proj.name);
    });

    row.addEventListener('click', () => {
      activeProjectName = proj.name;
      if (collapsedProjects.has(proj.name)) {
        collapsedProjects.delete(proj.name);
      } else if (projConvs.length > 0) {
        collapsedProjects.add(proj.name);
      }
      renderProjectsTree();
    });

    row.append(label, addBtn);
    group.appendChild(row);

    if (!isCollapsed && projConvs.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'conv-list';
      for (const c of projConvs) {
        const li = document.createElement('li');
        li.className = `conv-item${activeConv && activeConv.id === c.id ? ' active' : ''}`;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'conv-title';
        titleSpan.textContent = c.title || 'Новый диалог';

        const meta = document.createElement('span');
        meta.className = 'conv-meta';

        const age = document.createElement('span');
        age.className = 'conv-age';
        age.textContent = formatAge(c.updated_at);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'conv-del-btn';
        delBtn.textContent = '×';
        delBtn.title = 'Удалить диалог';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteConversationById(c.id);
        });

        meta.append(age, delBtn);
        li.append(titleSpan, meta);
        li.addEventListener('click', () => openConversationById(c.id));
        ul.appendChild(li);
      }
      group.appendChild(ul);
    }

    projectsTree.appendChild(group);
  }
}

// --- Sidebar & Right Drawer Controls ---
btnToggleSidebar.addEventListener('click', () => {
  sidebar.hidden = true;
  btnShowSidebar.hidden = false;
});

btnShowSidebar.addEventListener('click', () => {
  sidebar.hidden = false;
  btnShowSidebar.hidden = true;
});

function openDrawerTab(tabName) {
  inspectorDrawer.hidden = false;
  btnDrawerArtifacts.classList.toggle('active', tabName === 'artifacts');
  btnDrawerTools.classList.toggle('active', tabName !== 'artifacts');
  document.querySelectorAll('.drawer-tab').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tabName));
  });
  document.querySelectorAll('.drawer-panel').forEach((panel) => {
    panel.hidden = panel.id !== `panel-${tabName}`;
  });
  if (tabName === 'gpu' && !gpuBooted) {
    gpuBooted = true;
    bootGpuCore();
  }
}

btnDrawerArtifacts.addEventListener('click', () => {
  if (!inspectorDrawer.hidden && !document.getElementById('panel-artifacts').hidden) {
    inspectorDrawer.hidden = true;
    btnDrawerArtifacts.classList.remove('active');
  } else {
    openDrawerTab('artifacts');
  }
});

btnDrawerTools.addEventListener('click', () => {
  if (!inspectorDrawer.hidden && document.getElementById('panel-artifacts').hidden) {
    inspectorDrawer.hidden = true;
    btnDrawerTools.classList.remove('active');
  } else {
    openDrawerTab('gpu');
  }
});

btnCloseDrawer.addEventListener('click', () => {
  inspectorDrawer.hidden = true;
  btnDrawerArtifacts.classList.remove('active');
  btnDrawerTools.classList.remove('active');
});

document.querySelectorAll('.drawer-tab').forEach((btn) => {
  btn.addEventListener('click', () => openDrawerTab(btn.dataset.tab));
});

// --- Image Attachments (File Picker + Ctrl+V Paste + Drag & Drop) ---
function readImageFileOptimized(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx < 0) {
        reject(new Error('Некорректный формат изображения'));
        return;
      }
      const header = dataUrl.slice(0, commaIdx);
      const mimeMatch = header.match(/data:([^;]+);base64/i);
      const origMime = (mimeMatch && mimeMatch[1]) || file.type || 'image/png';
      const origBase64 = dataUrl.slice(commaIdx + 1);
      const name = file.name || `screenshot-${Date.now()}.png`;

      // Preserve animated GIFs or already compact images directly
      if (origMime === 'image/gif' || file.size <= 1_600_000) {
        resolve({ mime_type: origMime, data: origBase64, name });
        return;
      }

      const img = new Image();
      img.onerror = () => resolve({ mime_type: origMime, data: origBase64, name });
      img.onload = () => {
        const maxSide = 2048;
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          const scale = maxSide / Math.max(width, height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ mime_type: origMime, data: origBase64, name });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outMime = 'image/jpeg';
        const outUrl = canvas.toDataURL(outMime, 0.88);
        const outBase64 = outUrl.slice(outUrl.indexOf(',') + 1);
        resolve({ mime_type: outMime, data: outBase64, name });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function renderPendingAttachments() {
  if (!composerAttachments) return;
  composerAttachments.textContent = '';
  if (pendingImages.length === 0) {
    composerAttachments.hidden = true;
    return;
  }
  composerAttachments.hidden = false;
  pendingImages.forEach((img, idx) => {
    const dataUrl = `data:${img.mime_type};base64,${img.data}`;
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    const thumb = document.createElement('img');
    thumb.className = 'attachment-thumb';
    thumb.src = dataUrl;
    thumb.alt = img.name || 'Изображение';
    thumb.title = `${img.name || 'Изображение'} — нажмите для просмотра`;
    thumb.addEventListener('click', () => openImagePreview(dataUrl, img.name || 'Изображение'));

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'attachment-remove';
    rmBtn.textContent = '×';
    rmBtn.title = 'Убрать изображение';
    rmBtn.setAttribute('aria-label', 'Убрать изображение');
    rmBtn.addEventListener('click', () => {
      pendingImages.splice(idx, 1);
      renderPendingAttachments();
    });

    chip.append(thumb, rmBtn);
    composerAttachments.appendChild(chip);
  });
}

async function addImageFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const maxImages = 8;
  for (const file of Array.from(fileList)) {
    if (pendingImages.length >= maxImages) break;
    if (!file || !file.type || !file.type.startsWith('image/')) continue;
    try {
      const encoded = await readImageFileOptimized(file);
      pendingImages.push(encoded);
    } catch {
      // Skip unreadable image file
    }
  }
  renderPendingAttachments();
}

if (btnAttachImage && chatImageInput) {
  btnAttachImage.addEventListener('click', () => {
    chatImageInput.click();
  });

  chatImageInput.addEventListener('change', async () => {
    await addImageFiles(chatImageInput.files);
    chatImageInput.value = '';
    chatInput.focus();
  });
}

// Paste screenshot or copied image (Ctrl+V) anywhere while focused on chat
document.addEventListener('paste', async (event) => {
  const activeTag = document.activeElement?.tagName;
  if (
    document.activeElement === planEditor ||
    document.activeElement === taskEditor ||
    document.activeElement === codeEditor ||
    (activeTag === 'INPUT' && document.activeElement !== chatImageInput)
  ) {
    return;
  }
  const dt = event.clipboardData;
  if (!dt) return;
  const imageFiles = [];
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
  } else if (dt.files) {
    for (const f of Array.from(dt.files)) {
      if (f.type.startsWith('image/')) imageFiles.push(f);
    }
  }
  if (imageFiles.length > 0) {
    const hasPlainText = Boolean(dt.getData && dt.getData('text/plain'));
    if (!hasPlainText) {
      event.preventDefault();
    }
    await addImageFiles(imageFiles);
    chatInput.focus();
  }
});

// Drag & Drop images onto composer or chat feed
let dragDepth = 0;
for (const dropZone of [chatForm, chatScrollWrap]) {
  if (!dropZone) continue;
  dropZone.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    dragDepth += 1;
    chatForm.classList.add('drag-over');
  });
  dropZone.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  dropZone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) chatForm.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    chatForm.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) {
      await addImageFiles(e.dataTransfer.files);
      chatInput.focus();
    }
  });
}

// --- Chat Submission (IME-Safe Enter + Gemini 4 API + Multimodal Images) ---
async function submitChat() {
  const prompt = chatInput.value.trim();
  if ((!prompt && pendingImages.length === 0) || btnSendChat.disabled) return;
  if (!activeConv) startNewConversation(activeProjectName);

  const imagesToSend = pendingImages.map(({ mime_type, data, name }) => ({
    mime_type,
    data,
    name,
  }));
  pendingImages = [];
  renderPendingAttachments();

  chatInput.value = '';
  if (activeConv.messages.length === 0 || activeConv.title === 'Новый диалог') {
    const titleBase = prompt || imagesToSend[0]?.name || 'Изображение';
    activeConv.title = titleBase.length > 44 ? `${titleBase.slice(0, 44)}…` : titleBase;
    crumbTitle.textContent = activeConv.title;
  }

  const historyForApi = activeConv.messages.slice(-16).map((m) => ({
    role: m.role,
    content: m.content,
    images: Array.isArray(m.images) ? m.images : undefined,
  }));

  activeConv.messages.push({
    role: 'user',
    content: prompt,
    images: imagesToSend.length > 0 ? imagesToSend : undefined,
    meta: '',
  });
  appendMessageEl('user', prompt, '', imagesToSend);
  await saveActiveConversation();

  if (!isLocalDaemon) {
    const demoReply =
      'Вы находитесь в **облачной демо-песочнице** на `axiom-lang.org`.\n\n' +
      'Запустите `Axiom Studio` локально на вашем компьютере (`./launch_desktop.sh`), чтобы подключить автономного агента **Gemini 4 API** к файлам `~/Projects`.';
    activeConv.messages.push({ role: 'assistant', content: demoReply, meta: 'Облачное демо' });
    appendMessageEl('assistant', demoReply, 'Облачное демо');
    await saveActiveConversation();
    return;
  }

  btnSendChat.disabled = true;
  btnSendChat.hidden = true;
  if (btnStopChat) btnStopChat.hidden = false;

  const startedAt = Date.now();
  const thinkingRow = appendMessageEl('assistant', 'Запуск агента…', `${modelSelect.value} · 0 сек`);
  const thinkingBubble = thinkingRow.querySelector('.msg-bubble');
  const thinkingMeta = thinkingRow.querySelector('.msg-meta');

  activeChatAbort = new AbortController();
  let lastLiveStatus = 'Запрос к Gemini API…';
  activeStatusTimer = setInterval(async () => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    try {
      const sr = await fetch('/api/chat/status', { cache: 'no-store' });
      const sd = await sr.json();
      if (sd.status) lastLiveStatus = sd.status;
    } catch {
      // ignore transient poll error
    }
    if (thinkingBubble) thinkingBubble.textContent = `${lastLiveStatus} (нажмите ■ справа внизу, чтобы прервать)`;
    if (thinkingMeta) thinkingMeta.textContent = `${modelSelect.value} · ${secs} сек`;
  }, 850);

  try {
    const proj = getProjectByName(activeConv.project);

    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: activeChatAbort.signal,
      body: JSON.stringify({
        mode: 'gemini',
        model: modelSelect.value,
        prompt,
        images: imagesToSend,
        project_path: proj.path || '',
        history: historyForApi,
      }),
    });
    const d = await r.json();
    thinkingRow.remove();

    const stepIls = Number(d.cost_ils || 0);
    if (stepIls > 0) {
      spentIlsTotal += stepIls;
      updateBudgetUi();
    }

    const totalTok = Number(d.input_tokens || 0) + Number(d.output_tokens || 0);
    const metaStr = `${modelSelect.value} · ${stepIls.toFixed(3)} ₪ · ${totalTok} ток.`;
    const replyText = d.reply || '(Пустой ответ от модели)';

    activeConv.messages.push({ role: 'assistant', content: replyText, meta: metaStr });
    appendMessageEl('assistant', replyText, metaStr);
    await saveActiveConversation();

    // Hot-reload CSS if agent edited styles.css
    const cssLink = document.getElementById('studio-stylesheet');
    if (cssLink && replyText.includes('styles.css')) {
      cssLink.href = `./styles.css?v=${Date.now()}`;
    }
  } catch (err) {
    thinkingRow.remove();
    if (err && err.name === 'AbortError') {
      const stopMsg = 'Генерация прервана пользователем (запрос к Gemini API остановлен).';
      activeConv.messages.push({ role: 'assistant', content: stopMsg, meta: 'Остановлено' });
      appendMessageEl('assistant', stopMsg, 'Остановлено');
      await saveActiveConversation();
    } else {
      appendMessageEl('assistant', `Ошибка связи с локальным демоном: ${err}`, 'Ошибка');
    }
  } finally {
    if (activeStatusTimer) {
      clearInterval(activeStatusTimer);
      activeStatusTimer = null;
    }
    activeChatAbort = null;
    btnSendChat.disabled = false;
    btnSendChat.hidden = false;
    if (btnStopChat) btnStopChat.hidden = true;
    chatInput.focus();
  }
}

btnStopChat?.addEventListener('click', () => {
  if (isLocalDaemon) {
    fetch('/api/chat/cancel', { method: 'POST' }).catch(() => {});
  }
  if (activeChatAbort) {
    activeChatAbort.abort();
  }
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitChat();
});

// IME-safe Enter-to-submit (modern-web-guidance: ime-safe-enter-submit)
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    chatForm.requestSubmit();
  }
});

document.getElementById('btn-new-conv').addEventListener('click', () => startNewConversation(activeProjectName));

// --- `+` Add Context Popover Menu ---
const contextPopover = document.getElementById('context-menu-popover');
const contextTitle = document.getElementById('context-popover-title');
const contextBackBtn = document.getElementById('btn-context-back');
const contextRoot = document.getElementById('context-menu-root');
const contextSub = document.getElementById('context-menu-sub');

function resetContextPopoverView() {
  if (!contextRoot || !contextSub || !contextTitle || !contextBackBtn) return;
  contextTitle.textContent = 'Добавить контекст';
  contextBackBtn.hidden = true;
  contextRoot.hidden = false;
  contextSub.hidden = true;
  contextSub.textContent = '';
}

function closeContextPopover() {
  if (contextPopover && typeof contextPopover.hidePopover === 'function') {
    try {
      contextPopover.hidePopover();
    } catch {
      // already closed
    }
  }
  resetContextPopoverView();
}

function insertTokenIntoChat(token) {
  const cur = chatInput.value;
  const sep = cur.length > 0 && !/\s$/.test(cur) ? ' ' : '';
  chatInput.value = `${cur}${sep}${token} `;
  closeContextPopover();
  chatInput.focus();
}

contextPopover?.addEventListener('toggle', (e) => {
  if (e.newState === 'open') {
    resetContextPopoverView();
  }
});

contextBackBtn?.addEventListener('click', resetContextPopoverView);

document.getElementById('ctx-act-image')?.addEventListener('click', () => {
  closeContextPopover();
  chatImageInput?.click();
});

document.getElementById('ctx-act-files')?.addEventListener('click', () => {
  const proj = getProjectByName(activeProjectName);
  const files = proj.files || [];
  contextTitle.textContent = `Файлы: ${proj.name}`;
  contextBackBtn.hidden = false;
  contextRoot.hidden = true;
  contextSub.hidden = false;
  contextSub.textContent = '';

  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'setting-sub';
    empty.style.padding = '0.4rem 0.6rem';
    empty.textContent = 'Нет файлов в проекте';
    contextSub.appendChild(empty);
    return;
  }

  for (const f of files.slice(0, 40)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-item';
    btn.textContent = `📄 ${f}`;
    btn.addEventListener('click', () => insertTokenIntoChat(`@${proj.name}/${f}`));
    contextSub.appendChild(btn);
  }
});

document.getElementById('ctx-act-projects')?.addEventListener('click', () => {
  contextTitle.textContent = 'Упомянуть проект';
  contextBackBtn.hidden = false;
  contextRoot.hidden = true;
  contextSub.hidden = false;
  contextSub.textContent = '';

  for (const p of projects) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-item';
    btn.textContent = `📁 ${p.name}`;
    btn.addEventListener('click', () => insertTokenIntoChat(`@${p.name}`));
    contextSub.appendChild(btn);
  }
});

document.getElementById('ctx-act-verify')?.addEventListener('click', () => {
  closeContextPopover();
  verifyCurrentAx();
});

document.getElementById('ctx-act-new-chat')?.addEventListener('click', () => {
  closeContextPopover();
  startNewConversation(activeProjectName);
});

// --- Antigravity Brain History Importer ---
async function importAntigravitySession(sessionId) {
  if (!isLocalDaemon) {
    activeConv.plan_md = '# План внедрения (Демо)\nЗапустите Axiom Studio локально для чтения ~/.gemini/antigravity/brain/.';
    activeConv.task_md = '- [x] Этап 1: axiom-lang\n- [x] Этап 2: axiom-ui\n- [x] Этап 3: axiom-studio v2.0';
    renderActiveConversation();
    return;
  }

  const r = await fetch('/api/antigravity/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sessionId }),
  });
  const d = await r.json();
  if (!d.ok) return;

  const firstUser = (d.messages || []).find((m) => m.role === 'user' && m.content);
  const title = firstUser
    ? (firstUser.content.length > 42 ? `${firstUser.content.slice(0, 42)}…` : firstUser.content)
    : `Antigravity #${d.id.slice(0, 8)}`;

  activeConv = {
    id: `agy-${d.id.slice(0, 16)}`,
    project: activeProjectName,
    title,
    updated_at: Math.floor(Date.now() / 1000),
    messages: (d.messages || []).map((m) => ({
      role: m.role,
      content: m.content || `(Инструменты: ${(m.tools || []).join(', ')})`,
      meta: 'История Antigravity',
    })),
    plan_md: d.implementation_plan || '',
    task_md: d.task_md || '',
  };
  await saveActiveConversation();
  renderActiveConversation();
}

document.getElementById('btn-open-import').addEventListener('click', async () => {
  const listEl = document.getElementById('session-list');
  listEl.textContent = '';

  if (!isLocalDaemon) {
    const li = document.createElement('li');
    li.className = 'session-card';
    li.textContent = 'Демо-сессия Antigravity (нажмите для просмотра)';
    li.addEventListener('click', () => {
      importAntigravitySession('demo');
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
    title.style.fontWeight = '650';
    title.textContent = `${s.id.slice(0, 8)}… (${s.message_count} сообщ.) ${s.has_plan ? '· RU План ✓' : ''}`;
    const sub = document.createElement('div');
    sub.className = 'setting-sub';
    sub.textContent = s.last_user_prompt || '(без текста)';
    li.append(title, sub);
    li.addEventListener('click', () => {
      importAntigravitySession(s.id);
      dialogImport.close();
    });
    listEl.appendChild(li);
  }
  dialogImport.showModal();
});

// --- Settings Dialog (Theme, Scale, Key, Budget, Models) ---
document.getElementById('btn-open-settings').addEventListener('click', () => {
  dialogSettings.showModal();
});

document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.closeDialog)?.close();
  });
});

// Theme persistence
const savedTheme = localStorage.getItem('axiom_studio_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
document.getElementById('btn-theme').addEventListener('click', () => {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
  localStorage.setItem('axiom_studio_theme', next);
});

// Font Scale Controls
let uiScale = Number(localStorage.getItem('axiom_studio_font_scale')) || 1.08;
const fontResetBtn = document.getElementById('btn-font-reset');
function applyUiScale(next) {
  uiScale = Math.min(1.6, Math.max(0.85, Math.round(next * 100) / 100));
  document.body.style.setProperty('--ui-scale', String(uiScale));
  localStorage.setItem('axiom_studio_font_scale', String(uiScale));
  if (fontResetBtn) fontResetBtn.textContent = `${Math.round(uiScale * 100)}%`;
}
applyUiScale(uiScale);

document.getElementById('btn-font-dec').addEventListener('click', () => applyUiScale(uiScale - 0.08));
document.getElementById('btn-font-inc').addEventListener('click', () => applyUiScale(uiScale + 0.08));
fontResetBtn.addEventListener('click', () => applyUiScale(1.08));

document.getElementById('btn-reset-budget').addEventListener('click', () => {
  spentIlsTotal = 0;
  updateBudgetUi();
});

document.getElementById('key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const inp = document.getElementById('key-input');
  const val = inp.value.trim();
  if (!val || !isLocalDaemon) return;
  const r = await fetch('/api/config/key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: val }),
  });
  const d = await r.json();
  inp.value = '';
  if (d.ok) {
    modelsSyncStatus.textContent = 'Ключ сохранён локально в ~/.env (права 0600)!';
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
    modelsSyncStatus.textContent = `Загружено ${d.models.length} моделей с вашего API-ключа.`;
  } else {
    modelsSyncStatus.textContent = 'Сначала сохраните GEMINI_API_KEY ниже.';
  }
});

// --- On-Demand Drawer Tools: Files, Z3 Verify, Shell, WebGL2 GPU Core ---
function syncProjectFilesSelect() {
  const proj = getProjectByName(activeProjectName);
  fileSelect.textContent = '';
  for (const f of proj.files || []) {
    const opt = document.createElement('option');
    opt.value = `${proj.path}/${f}`;
    opt.textContent = f;
    fileSelect.appendChild(opt);
  }
  if (fileSelect.options.length > 0) {
    openFilePath(fileSelect.options[0].value);
  }
}

async function openFilePath(fullPath) {
  currentFilePath = fullPath;
  if (!isLocalDaemon) {
    codeEditor.value = DEMO_CODE;
    return;
  }
  const r = await fetch(`/api/file?path=${encodeURIComponent(fullPath)}`);
  const d = await r.json();
  if (d.ok) codeEditor.value = d.content || '';
}

fileSelect.addEventListener('change', () => openFilePath(fileSelect.value));

document.getElementById('btn-save-file').addEventListener('click', async () => {
  if (!isLocalDaemon || !currentFilePath) return;
  const r = await fetch('/api/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: currentFilePath, content: codeEditor.value }),
  });
  const d = await r.json();
  shellOutput.textContent = d.ok ? `Сохранено: ${currentFilePath}` : `Ошибка: ${d.error}`;
});

async function verifyCurrentAx() {
  if (!isLocalDaemon || !currentFilePath.endsWith('.ax')) {
    shellOutput.textContent = 'Выберите .ax файл во вкладке «Код» для проверки Z3 + Wasm.';
    return;
  }
  openDrawerTab('shell');
  shellOutput.textContent = `Проверка Z3 + Wasm: ${currentFilePath}...`;
  const r = await fetch('/api/axiom/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: currentFilePath }),
  });
  const d = await r.json();
  shellOutput.textContent = `${d.output || ''}\n[Z3: ${d.ok ? 'ДОКАЗАНО ✓' : 'ОШИБКА'} | Wasm: ${d.wasm_kb || 0} KB]`;
}

document.getElementById('btn-verify-ax').addEventListener('click', verifyCurrentAx);
document.getElementById('btn-verify-ax-gpu').addEventListener('click', verifyCurrentAx);

async function runShellCmd(cmd) {
  if (!cmd.trim()) return;
  if (!isLocalDaemon) {
    shellOutput.textContent = `[DEMO] $ ${cmd}\nЗапустите ./launch_desktop.sh локально для выполнения команд.`;
    return;
  }
  const proj = getProjectByName(activeProjectName);
  shellOutput.textContent = `$ ${cmd}\nВыполнение...`;
  const r = await fetch('/api/shell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: proj.path || '', cmd }),
  });
  const d = await r.json();
  shellOutput.textContent = `${d.output || ''}\n[Код: ${d.exit_code} | Лог: ${d.log_file || ''}]`;
}

document.getElementById('shell-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = document.getElementById('shell-input');
  const cmd = inp.value;
  inp.value = '';
  runShellCmd(cmd);
});

document.querySelectorAll('[data-quick-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => runShellCmd(btn.getAttribute('data-quick-cmd')));
});

// Lazy WebGL2 GPU Graph (`studio_core.wasm`)
function buildUnicodeAtlas() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px "DejaVu Sans", "Liberation Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 95; i++) {
    ctx.fillText(String.fromCharCode(32 + i), (i % 16) * 32 + 16, Math.floor(i / 16) * 32 + 16);
  }
  for (let i = 0; i < 64; i++) {
    const idx = 96 + i;
    ctx.fillText(String.fromCharCode(0x0410 + i), (idx % 16) * 32 + 16, Math.floor(idx / 16) * 32 + 16);
  }
  const extras = [[160, 'Ё'], [161, 'ё'], [162, '₪'], [163, '№'], [164, '—'], [165, '•'], [166, '✓']];
  for (const [idx, ch] of extras) {
    ctx.fillText(ch, (idx % 16) * 32 + 16, Math.floor(idx / 16) * 32 + 16);
  }
  return c;
}

async function bootGpuCore() {
  try {
    const gl = gpuCanvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) return;
    const vsSrc = `#version 300 es
      layout(location=0) in vec2 a_pos;
      layout(location=1) in vec2 a_uv;
      layout(location=2) in vec4 a_col;
      uniform vec2 u_res;
      out vec2 v_uv;
      out vec4 v_col;
      void main() {
        vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        v_uv = a_uv;
        v_col = a_col;
      }`;
    const fsSrc = `#version 300 es
      precision mediump float;
      in vec2 v_uv;
      in vec4 v_col;
      uniform sampler2D u_atlas;
      out vec4 o_col;
      void main() {
        if (v_uv.x < 0.0) { o_col = v_col; }
        else {
          float a = texture(u_atlas, v_uv).a;
          if (a < 0.05) discard;
          o_col = vec4(v_col.rgb, v_col.a * a);
        }
      }`;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildUnicodeAtlas());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const vbo = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);

    const res = await fetch('./studio_core.wasm');
    const bytes = await res.arrayBuffer();
    const inst = await WebAssembly.instantiate(bytes, {
      env: { abort: () => {}, print_i64: () => {} },
    });
    wasmExports = inst.instance.exports;
    wasmMem = wasmExports.memory;
    wasmExports.init_studio();

    const uRes = gl.getUniformLocation(prog, 'u_res');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const frame = () => {
      if (!inspectorDrawer.hidden && !document.getElementById('panel-gpu').hidden) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(240, Math.floor(gpuCanvas.clientWidth));
        const h = Math.max(200, Math.floor(gpuCanvas.clientHeight));
        if (gpuCanvas.width !== Math.floor(w * dpr) || gpuCanvas.height !== Math.floor(h * dpr)) {
          gpuCanvas.width = Math.floor(w * dpr);
          gpuCanvas.height = Math.floor(h * dpr);
        }
        gl.viewport(0, 0, gpuCanvas.width, gpuCanvas.height);
        gl.uniform2f(uRes, w, h);
        gl.clearColor(0.028, 0.045, 0.095, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const vCount = wasmExports.render_studio(w, h, 16);
        const floats = new Float32Array(wasmMem.buffer, 65536, vCount * 8);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, floats, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, vCount);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  } catch (e) {
    console.warn('GPU Core init skipped:', e);
  }
}

// --- Boot Studio v2.0 ---
async function bootStudio() {
  updateBudgetUi();

  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    if (r.ok) {
      const st = await r.json();
      if (st.online) {
        isLocalDaemon = true;
        sidebarRamPill.textContent = `${st.rss_mb} МБ`;
        daemonStatusText.textContent = `Активен на 127.0.0.1:7700 (${st.rss_mb} МБ ОЗУ vs ~680 МБ Electron)`;
      }
    }
  } catch {
    isLocalDaemon = false;
  }

  if (isLocalDaemon) {
    const pr = await fetch('/api/projects');
    const pd = await pr.json();
    projects = pd.projects || DEMO_PROJECTS;
  } else {
    projects = DEMO_PROJECTS;
    sidebarRamPill.textContent = 'Демо';
    daemonStatusText.textContent = 'Облачная песочница (для локального доступа запустите ./launch_desktop.sh)';
  }

  await refreshConversationsList();
  if (conversations.length > 0) {
    await openConversationById(conversations[0].id);
  } else {
    startNewConversation(projects[0]?.name || 'axiom-studio');
  }
}

bootStudio();
