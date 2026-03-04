const COLORS = [
  { name: 'blue',   hex: '#4A90D9' },
  { name: 'green',  hex: '#48BF91' },
  { name: 'red',    hex: '#E57373' },
  { name: 'yellow', hex: '#F0C040' },
  { name: 'purple', hex: '#AB7AE0' },
  { name: 'pink',   hex: '#E091B8' },
  { name: 'cyan',   hex: '#4DC9F6' },
  { name: 'orange', hex: '#F5A623' },
];

const SYSTEM_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'about:',
  'edge://',
  'brave://',
];

const msg = chrome.i18n.getMessage;

let tabGroups = [];

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  // Apply i18n to static elements
  document.getElementById('searchInput').placeholder = msg('searchPlaceholder');
  document.getElementById('emptyText').textContent = msg('emptyState');

  await loadGroups();
  await autoSaveTabs();
  renderGroups();

  document.getElementById('searchInput').addEventListener('input', (e) => {
    renderGroups(e.target.value.trim().toLowerCase());
  });
});

// --- Storage ---

async function loadGroups() {
  const data = await chrome.storage.local.get('tabGroups');
  tabGroups = data.tabGroups || [];
}

async function saveGroups() {
  await chrome.storage.local.set({ tabGroups });
}

// --- Auto-save tabs on popup open ---

async function autoSaveTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter((tab) =>
    tab.url && !SYSTEM_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix))
  );

  if (saveable.length === 0) return;

  const now = new Date();
  const name = formatDate(now);
  const colorIndex = tabGroups.length % COLORS.length;

  const group = {
    id: crypto.randomUUID(),
    name,
    color: COLORS[colorIndex].hex,
    isProtected: false,
    tabs: saveable.map((tab) => ({
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || '',
    })),
    createdAt: now.getTime(),
    tabCount: saveable.length,
  };

  tabGroups.unshift(group);
  await saveGroups();

  // Close saved tabs and open a new blank tab
  const newTab = await chrome.tabs.create({ active: true });
  const tabIdsToClose = saveable
    .map((t) => t.id)
    .filter((id) => id !== newTab.id);
  if (tabIdsToClose.length > 0) {
    await chrome.tabs.remove(tabIdsToClose);
  }

  showToast(msg('tabsSaved', [String(saveable.length)]));
}

// --- Rendering ---

function renderGroups(searchQuery = '') {
  const listEl = document.getElementById('groupList');
  const emptyEl = document.getElementById('emptyState');
  listEl.innerHTML = '';

  let filtered = tabGroups;
  if (searchQuery) {
    filtered = tabGroups
      .map((group) => {
        const matchingTabs = group.tabs.filter(
          (tab) =>
            tab.title.toLowerCase().includes(searchQuery) ||
            tab.url.toLowerCase().includes(searchQuery)
        );
        if (matchingTabs.length > 0) {
          return { ...group, _matchingTabs: matchingTabs };
        }
        if (group.name.toLowerCase().includes(searchQuery)) {
          return { ...group, _matchingTabs: null };
        }
        return null;
      })
      .filter(Boolean);
  }

  if (filtered.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');

  filtered.forEach((group) => {
    listEl.appendChild(createGroupCard(group, searchQuery));
  });
}

function createGroupCard(group, searchQuery) {
  const card = document.createElement('div');
  card.className = 'group-card';
  card.style.setProperty('--group-color', group.color);
  card.dataset.id = group.id;

  // Header
  const header = document.createElement('div');
  header.className = 'group-header';

  const dot = document.createElement('span');
  dot.className = 'group-color-dot';

  const nameEl = document.createElement('span');
  nameEl.className = 'group-name';
  nameEl.textContent = group.name;

  const meta = document.createElement('span');
  meta.className = 'group-meta';
  if (group.isProtected) {
    const badge = document.createElement('span');
    badge.className = 'protected-badge';
    badge.textContent = '\u{1F512}';
    badge.title = msg('protected');
    meta.appendChild(badge);
  }
  const countBadge = document.createElement('span');
  countBadge.className = 'group-tab-count';
  countBadge.textContent = `${group.tabCount}`;
  meta.appendChild(countBadge);

  const expandIcon = document.createElement('span');
  expandIcon.className = 'expand-icon';
  expandIcon.innerHTML = '\u25B6';

  header.append(dot, nameEl, meta, expandIcon);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'group-actions';

  actions.appendChild(
    createActionBtn('restore', `\u25B6 ${msg('restore')}`, () => restoreGroup(group.id))
  );
  actions.appendChild(
    createActionBtn('color', '\u{1F3A8}', () => toggleColorPicker(card))
  );
  actions.appendChild(
    createActionBtn(
      'protect',
      group.isProtected ? '\u{1F512}' : '\u{1F513}',
      () => toggleProtect(group.id)
    )
  );
  actions.appendChild(
    createActionBtn('rename', '\u270F\uFE0F', () => startRename(card, group.id))
  );
  actions.appendChild(
    createActionBtn('delete', '\u{1F5D1}', () =>
      showDeleteConfirm(group.id, group.name)
    )
  );

  // Color picker
  const colorPicker = document.createElement('div');
  colorPicker.className = 'color-picker';
  COLORS.forEach((c) => {
    const opt = document.createElement('span');
    opt.className = 'color-option';
    if (c.hex === group.color) opt.classList.add('selected');
    opt.style.background = c.hex;
    opt.title = c.name;
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      changeColor(group.id, c.hex);
    });
    colorPicker.appendChild(opt);
  });

  // Tab list
  const tabList = document.createElement('div');
  tabList.className = 'tab-list';

  const matchingUrls = group._matchingTabs
    ? new Set(group._matchingTabs.map((t) => t.url))
    : null;

  group.tabs.forEach((tab) => {
    const item = document.createElement('div');
    item.className = 'tab-item';

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.width = 14;
    favicon.height = 14;
    if (tab.favIconUrl) {
      favicon.src = tab.favIconUrl;
      favicon.onerror = () => {
        favicon.style.display = 'none';
      };
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title;
    title.title = tab.url;

    if (searchQuery && matchingUrls && matchingUrls.has(tab.url)) {
      title.classList.add('highlight');
    }

    item.append(favicon, title);
    tabList.appendChild(item);
  });

  // Toggle expand
  header.addEventListener('click', () => {
    tabList.classList.toggle('visible');
    expandIcon.classList.toggle('expanded');
  });

  // Auto-expand if searching
  if (searchQuery) {
    tabList.classList.add('visible');
    expandIcon.classList.add('expanded');
  }

  card.append(header, actions, colorPicker, tabList);
  return card;
}

function createActionBtn(type, label, onClick) {
  const btn = document.createElement('button');
  btn.className = `action-btn ${type}`;
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// --- Actions ---

async function restoreGroup(id) {
  const group = tabGroups.find((g) => g.id === id);
  if (!group) return;

  for (const tab of group.tabs) {
    await chrome.tabs.create({ url: tab.url, active: false });
  }

  if (!group.isProtected) {
    tabGroups = tabGroups.filter((g) => g.id !== id);
    await saveGroups();

    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.classList.add('removing');
      card.addEventListener('animationend', () => {
        renderGroups(
          document.getElementById('searchInput').value.trim().toLowerCase()
        );
      });
    }
  }

  showToast(msg('tabsRestored', [String(group.tabs.length)]));
}

async function toggleProtect(id) {
  const group = tabGroups.find((g) => g.id === id);
  if (!group) return;

  group.isProtected = !group.isProtected;
  await saveGroups();
  renderGroups(document.getElementById('searchInput').value.trim().toLowerCase());
}

function toggleColorPicker(card) {
  const picker = card.querySelector('.color-picker');
  picker.classList.toggle('visible');
}

async function changeColor(id, hex) {
  const group = tabGroups.find((g) => g.id === id);
  if (!group) return;

  group.color = hex;
  await saveGroups();
  renderGroups(document.getElementById('searchInput').value.trim().toLowerCase());
}

function startRename(card, id) {
  const group = tabGroups.find((g) => g.id === id);
  if (!group) return;

  const nameEl = card.querySelector('.group-name');
  if (!nameEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'group-name-input';
  input.value = group.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const finishRename = async () => {
    const newName = input.value.trim();
    if (newName && newName !== group.name) {
      group.name = newName;
      await saveGroups();
    }
    renderGroups(
      document.getElementById('searchInput').value.trim().toLowerCase()
    );
  };

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = group.name;
      input.blur();
    }
  });
}

function showDeleteConfirm(id, name) {
  const existing = document.querySelector('.confirm-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay visible';

  const dialog = document.createElement('div');
  dialog.className = 'confirm-dialog';

  const msgEl = document.createElement('p');
  msgEl.textContent = msg('deleteConfirm', [name]);

  const buttons = document.createElement('div');
  buttons.className = 'confirm-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = msg('cancel');
  cancelBtn.addEventListener('click', () => overlay.remove());

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-confirm-delete';
  deleteBtn.textContent = msg('delete');
  deleteBtn.addEventListener('click', async () => {
    overlay.remove();
    await deleteGroup(id);
  });

  buttons.append(cancelBtn, deleteBtn);
  dialog.append(msgEl, buttons);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

async function deleteGroup(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.classList.add('removing');
    await new Promise((resolve) =>
      card.addEventListener('animationend', resolve)
    );
  }

  tabGroups = tabGroups.filter((g) => g.id !== id);
  await saveGroups();
  renderGroups(document.getElementById('searchInput').value.trim().toLowerCase());
}

// --- Helpers ---

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.style.animation = 'none';
  toast.offsetHeight; // force reflow
  toast.style.animation = 'slideIn 0.3s ease';

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => {
      toast.classList.add('hidden');
      toast.style.animation = '';
    }, 300);
  }, 3000);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}
