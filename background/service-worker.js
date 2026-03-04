chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ tabGroups: [] });
  }
});

// Handle tab close/create requests from popup
// Popup closes when focus changes, so this must run in the service worker.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'closeTabs') {
    handleCloseTabs(message.tabIds).then(() => sendResponse({ ok: true }));
    return true; // keep channel open for async
  }
});

async function handleCloseTabs(tabIds) {
  // Create a new blank tab first
  await chrome.tabs.create({ active: true });
  // Then close the saved tabs
  if (tabIds.length > 0) {
    await chrome.tabs.remove(tabIds);
  }
}
