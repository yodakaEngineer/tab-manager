const SYSTEM_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'about:',
  'edge://',
  'brave://',
];

const COLORS = [
  '#4A90D9', '#48BF91', '#E57373', '#F0C040',
  '#AB7AE0', '#E091B8', '#4DC9F6', '#F5A623',
];

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ tabGroups: [] });
  }
});

// No default_popup → onClicked fires when the icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await saveAndCloseTabs();
});

async function saveAndCloseTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });

  // Filter: exclude system tabs and pinned tabs
  const saveable = tabs.filter((tab) =>
    tab.url &&
    !tab.pinned &&
    !SYSTEM_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix))
  );

  if (saveable.length === 0) {
    // Nothing to save — just open the management page
    await openManagementPage();
    return;
  }

  // Build the group
  const data = await chrome.storage.local.get('tabGroups');
  const tabGroups = data.tabGroups || [];

  const now = new Date();
  const colorIndex = tabGroups.length % COLORS.length;

  const group = {
    id: crypto.randomUUID(),
    name: formatDate(now),
    color: COLORS[colorIndex],
    isProtected: false,
    tabs: saveable.map((t) => ({
      url: t.url,
      title: t.title || t.url,
      favIconUrl: t.favIconUrl || '',
    })),
    createdAt: now.getTime(),
    tabCount: saveable.length,
  };

  tabGroups.unshift(group);

  // Save to storage FIRST, before touching any tabs
  await chrome.storage.local.set({ tabGroups, lastSavedCount: saveable.length });

  // Open the management page as a new tab
  await openManagementPage();

  // Close the saved tabs
  const tabIds = saveable.map((t) => t.id);
  await chrome.tabs.remove(tabIds);
}

async function openManagementPage() {
  const manageUrl = chrome.runtime.getURL('popup/popup.html');

  // Reuse existing management tab if open
  const existing = await chrome.tabs.query({ url: manageUrl });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.tabs.reload(existing[0].id);
  } else {
    await chrome.tabs.create({ url: manageUrl, active: true });
  }
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}
