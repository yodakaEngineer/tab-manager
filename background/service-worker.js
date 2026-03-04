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

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'saveAndCloseTabs') {
    saveAndCloseTabs()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ saved: false, error: err.message }));
    return true; // keep channel open for async
  }
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
    return { saved: false, count: 0 };
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
    tabs: saveable.map((tab) => ({
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || '',
    })),
    createdAt: now.getTime(),
    tabCount: saveable.length,
  };

  tabGroups.unshift(group);

  // Save to storage first, before touching any tabs
  await chrome.storage.local.set({ tabGroups, lastSavedCount: saveable.length });

  // Now close tabs and open a new one
  await chrome.tabs.create({ active: true });
  const tabIds = saveable.map((t) => t.id);
  await chrome.tabs.remove(tabIds);

  return { saved: true, count: saveable.length };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}
