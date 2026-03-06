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

const msg = chrome.i18n.getMessage;

let tabGroups = [];

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  // Apply i18n to static elements
  document.getElementById('searchInput').placeholder = msg('searchPlaceholder');
  document.getElementById('emptyText').textContent = msg('emptyState');

  // Load and display groups (saving is handled by the service worker)
  await loadGroups();
  renderGroups();

  // Show toast if tabs were just saved
  const { lastSavedCount } = await chrome.storage.local.get('lastSavedCount');
  if (lastSavedCount) {
    showToast(msg('tabsSaved', [String(lastSavedCount)]));
    await chrome.storage.local.remove('lastSavedCount');
  }

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
  nameEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startRename(card, group.id);
  });

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
    favicon.width = 16;
    favicon.height = 16;
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

    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
      chrome.tabs.create({ url: tab.url, active: false });
      showToast(msg('tabOpened'));
    });

    item.append(favicon, title);
    tabList.appendChild(item);
  });

  // Toggle expand
  header.addEventListener('click', () => {
    tabList.classList.toggle('visible');
    expandIcon.classList.toggle('expanded');
  });

  // Always expand by default
  tabList.classList.add('visible');
  expandIcon.classList.add('expanded');

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

let pendingDelete = null;

function showDeleteConfirm(id, name) {
  const group = tabGroups.find((g) => g.id === id);
  if (group && group.isProtected) {
    alert(msg('deleteLockedWarning'));
    return;
  }

  // Finalize any previous pending delete
  finalizePendingDelete();

  const index = tabGroups.findIndex((g) => g.id === id);
  const deletedGroup = tabGroups[index];

  // Remove from array (but don't save yet)
  tabGroups.splice(index, 1);

  // Animate card removal then re-render
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.classList.add('removing');
    card.addEventListener('animationend', () => {
      renderGroups(document.getElementById('searchInput').value.trim().toLowerCase());
    });
  } else {
    renderGroups(document.getElementById('searchInput').value.trim().toLowerCase());
  }

  showUndoToast(name, deletedGroup, index);
}

function showUndoToast(name, deletedGroup, originalIndex) {
  // Remove existing undo toast if any
  const existing = document.querySelector('.undo-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'undo-toast';

  const text = document.createElement('span');
  text.className = 'undo-toast-text';
  text.textContent = msg('groupDeleted', [name]);

  const undoBtn = document.createElement('button');
  undoBtn.className = 'undo-toast-btn';
  undoBtn.textContent = msg('undoRestore');

  toast.append(text, undoBtn);
  document.getElementById('toast').insertAdjacentElement('afterend', toast);

  toast.style.animation = 'slideIn 0.3s ease';

  const timerId = setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => {
      toast.remove();
      if (pendingDelete && pendingDelete.timerId === timerId) {
        saveGroups();
        pendingDelete = null;
      }
    }, 300);
  }, 5000);

  pendingDelete = { deletedGroup, originalIndex, timerId };

  undoBtn.addEventListener('click', () => {
    clearTimeout(timerId);
    toast.remove();
    // Restore group at original position
    tabGroups.splice(originalIndex, 0, deletedGroup);
    saveGroups();
    renderGroups(document.getElementById('searchInput').value.trim().toLowerCase());
    pendingDelete = null;
  });
}

function finalizePendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timerId);
  const existing = document.querySelector('.undo-toast');
  if (existing) existing.remove();
  saveGroups();
  pendingDelete = null;
}

// Finalize pending delete when popup closes
window.addEventListener('beforeunload', () => {
  if (pendingDelete) {
    // Use sync storage write via sendMessage or just save
    finalizePendingDelete();
  }
});

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
