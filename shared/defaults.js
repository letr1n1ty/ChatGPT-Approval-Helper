var ApprovalHelperDefaults = (() => {
  const DEFAULT_TRUSTED_TOOLS = Object.freeze([
    "apply_patch",
    "exec_command",
    "write_stdin",
    "kill_session",
    "replace_text",
    "run_npm_test",
    "run_npm_typecheck",
    "run_npm_build",
    "git_status",
    "git_diff"
  ]);

  const DEFAULT_TRUSTED_SERVERS = Object.freeze([
    "MCP Neverending Coding"
  ]);

  const DEFAULT_TRUSTED_CONNECTORS = Object.freeze([
    "GitHub"
  ]);

  const SUPPORTED_LANGUAGES = Object.freeze(["zh-Hant", "zh-Hans", "en"]);
  const STORAGE_KEYS = Object.freeze([
    "autoApprove",
    "trustedTools",
    "trustedServers",
    "trustedConnectors",
    "language"
  ]);

  const FALLBACK_STORAGE_KEY = "mcp_approval_settings_fallback_v2";
  const APPROVAL_LOG_KEY = "mcpApprovalHelperLog";

  function detectBrowserLanguage() {
    const languages = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || "en"];

    for (const rawLanguage of languages) {
      const language = String(rawLanguage || "").toLowerCase();
      if (!language) continue;

      if (language.startsWith("zh")) {
        if (language.includes("hans") || language.includes("cn") || language.includes("sg")) return "zh-Hans";
        if (language.includes("hant") || language.includes("tw") || language.includes("hk") || language.includes("mo")) return "zh-Hant";
        return "zh-Hant";
      }

      if (language.startsWith("en")) return "en";
    }

    return "en";
  }

  function normalizeLanguage(language) {
    return SUPPORTED_LANGUAGES.includes(language) ? language : detectBrowserLanguage();
  }

  function uniqueValues(values) {
    return Array.from(new Set((values || []).map(value => String(value).trim()).filter(Boolean)));
  }

  function getDefaultSettings() {
    return {
      autoApprove: false,
      trustedTools: [...DEFAULT_TRUSTED_TOOLS],
      trustedServers: [...DEFAULT_TRUSTED_SERVERS],
      trustedConnectors: [...DEFAULT_TRUSTED_CONNECTORS],
      language: detectBrowserLanguage()
    };
  }

  function normalizeSettings(settings = {}) {
    return {
      autoApprove: settings.autoApprove === true,
      trustedTools: uniqueValues(settings.trustedTools !== undefined ? settings.trustedTools : DEFAULT_TRUSTED_TOOLS),
      trustedServers: uniqueValues(settings.trustedServers !== undefined ? settings.trustedServers : DEFAULT_TRUSTED_SERVERS),
      trustedConnectors: uniqueValues(settings.trustedConnectors !== undefined ? settings.trustedConnectors : DEFAULT_TRUSTED_CONNECTORS),
      language: normalizeLanguage(settings.language)
    };
  }

  return {
    DEFAULT_TRUSTED_TOOLS,
    DEFAULT_TRUSTED_SERVERS,
    DEFAULT_TRUSTED_CONNECTORS,
    SUPPORTED_LANGUAGES,
    STORAGE_KEYS,
    FALLBACK_STORAGE_KEY,
    APPROVAL_LOG_KEY,
    detectBrowserLanguage,
    normalizeLanguage,
    uniqueValues,
    getDefaultSettings,
    normalizeSettings
  };
})();
