var ApprovalHelperStorage = (() => {
  const defaults = globalThis.ApprovalHelperDefaults;

  function hasChromeStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  async function getSettings() {
    try {
      if (hasChromeStorage()) {
        const data = await chrome.storage.local.get(defaults.STORAGE_KEYS);
        return defaults.normalizeSettings(data);
      }
    } catch (error) {
      console.error("[Approval Helper] Failed to read chrome.storage.local:", error);
    }

    try {
      const fallback = localStorage.getItem(defaults.FALLBACK_STORAGE_KEY);
      return defaults.normalizeSettings(fallback ? JSON.parse(fallback) : defaults.getDefaultSettings());
    } catch (error) {
      console.error("[Approval Helper] Failed to read fallback settings:", error);
      return defaults.getDefaultSettings();
    }
  }

  async function saveSettings(settings) {
    const normalized = defaults.normalizeSettings(settings);

    try {
      if (hasChromeStorage()) {
        await chrome.storage.local.set(normalized);
      } else {
        localStorage.setItem(defaults.FALLBACK_STORAGE_KEY, JSON.stringify(normalized));
      }
    } catch (error) {
      console.error("[Approval Helper] Failed to save settings:", error);
      throw error;
    }

    return normalized;
  }

  function onSettingsChanged(callback) {
    if (!(typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged)) return;

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== "local") return;
      if (!defaults.STORAGE_KEYS.some(key => changes[key])) return;
      callback(changes);
    });
  }

  function logApproval({ toolName, trusted, url = location.href }) {
    try {
      const oldLog = JSON.parse(localStorage.getItem(defaults.APPROVAL_LOG_KEY) || "[]");
      oldLog.push({
        toolName,
        trusted,
        time: new Date().toISOString(),
        url
      });
      localStorage.setItem(defaults.APPROVAL_LOG_KEY, JSON.stringify(oldLog.slice(-200)));
    } catch (error) {
      console.error("[Approval Helper] Failed to write audit log:", error);
    }
  }

  return {
    getSettings,
    saveSettings,
    onSettingsChanged,
    logApproval
  };
})();
