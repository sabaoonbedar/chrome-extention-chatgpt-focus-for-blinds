chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "COMMAND", command });
});


chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg?.type === "PANEL_CMD" || msg?.type === "PANEL_QUERY") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return sendResponse({ error: "No active tab." });
    chrome.tabs.sendMessage(tab.id, msg, sendResponse);
    return true; 
  }
});
