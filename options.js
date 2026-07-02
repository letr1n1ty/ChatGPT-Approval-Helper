// 預設信任的 API 工具清單
const DEFAULT_TRUSTED_TOOLS = [
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
];

// 預設信任的 MCP 伺服器清單
const DEFAULT_TRUSTED_SERVERS = [
  "MCP Neverending Coding"
];

// DOM 元素
const autoApproveToggle = document.getElementById("auto-approve-toggle");
const toolInput = document.getElementById("tool-input");
const addToolBtn = document.getElementById("add-tool-btn");
const chipsListTools = document.getElementById("chips-list-tools");

const serverInput = document.getElementById("server-input");
const addServerBtn = document.getElementById("add-server-btn");
const chipsListServers = document.getElementById("chips-list-servers");

const resetBtn = document.getElementById("reset-btn");
const saveToast = document.getElementById("save-toast");

// 當前設定狀態
let currentSettings = {
  autoApprove: false,
  trustedTools: [],
  trustedServers: []
};

// 顯示 Toast 提示
let toastTimeout;
function showToast() {
  clearTimeout(toastTimeout);
  saveToast.classList.add("show");
  toastTimeout = setTimeout(() => {
    saveToast.classList.remove("show");
  }, 2000);
}

// 渲染信任 API 工具的 Chips
function renderToolChips() {
  chipsListTools.innerHTML = "";
  
  if (currentSettings.trustedTools.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "empty-state";
    emptyMsg.textContent = "目前沒有設定信任的 API 工具。";
    chipsListTools.appendChild(emptyMsg);
    return;
  }

  currentSettings.trustedTools.forEach(tool => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = tool;

    const deleteBtn = document.createElement("span");
    deleteBtn.className = "chip-delete";
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", () => removeTool(tool));

    chip.appendChild(deleteBtn);
    chipsListTools.appendChild(chip);
  });
}

// 渲染信任 MCP 伺服器的 Chips
function renderServerChips() {
  chipsListServers.innerHTML = "";
  
  if (currentSettings.trustedServers.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "empty-state";
    emptyMsg.textContent = "目前沒有設定信任的 MCP 伺服器。";
    chipsListServers.appendChild(emptyMsg);
    return;
  }

  currentSettings.trustedServers.forEach(server => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = server;

    const deleteBtn = document.createElement("span");
    deleteBtn.className = "chip-delete";
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", () => removeServer(server));

    chip.appendChild(deleteBtn);
    chipsListServers.appendChild(chip);
  });
}

function renderAllChips() {
  renderToolChips();
  renderServerChips();
}

// 儲存設定至 chrome.storage
async function saveSettings() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        autoApprove: currentSettings.autoApprove,
        trustedTools: currentSettings.trustedTools,
        trustedServers: currentSettings.trustedServers
      });
    } else {
      // 供本地測試/無 extension 環境時的 fallback
      localStorage.setItem("mcp_approval_settings_fallback_v2", JSON.stringify(currentSettings));
    }
    showToast();
  } catch (error) {
    console.error("儲存設定失敗:", error);
  }
}

// 載入設定
async function loadSettings() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get(["autoApprove", "trustedTools", "trustedServers"]);
      
      currentSettings.autoApprove = data.autoApprove !== undefined ? data.autoApprove : false;
      currentSettings.trustedTools = data.trustedTools !== undefined ? data.trustedTools : [...DEFAULT_TRUSTED_TOOLS];
      currentSettings.trustedServers = data.trustedServers !== undefined ? data.trustedServers : [...DEFAULT_TRUSTED_SERVERS];
    } else {
      // 本地測試 fallback
      const fallback = localStorage.getItem("mcp_approval_settings_fallback_v2");
      if (fallback) {
        currentSettings = JSON.parse(fallback);
      } else {
        currentSettings.autoApprove = false;
        currentSettings.trustedTools = [...DEFAULT_TRUSTED_TOOLS];
        currentSettings.trustedServers = [...DEFAULT_TRUSTED_SERVERS];
      }
    }

    // 更新 UI
    autoApproveToggle.checked = currentSettings.autoApprove;
    renderAllChips();
  } catch (error) {
    console.error("載入設定失敗:", error);
  }
}

// 新增工具
function addTool() {
  const toolName = toolInput.value.trim();
  if (!toolName) return;

  if (!currentSettings.trustedTools.includes(toolName)) {
    currentSettings.trustedTools.push(toolName);
    renderToolChips();
    saveSettings();
  }
  
  toolInput.value = "";
  toolInput.focus();
}

// 刪除工具
function removeTool(toolName) {
  currentSettings.trustedTools = currentSettings.trustedTools.filter(t => t !== toolName);
  renderToolChips();
  saveSettings();
}

// 新增伺服器
function addServer() {
  const serverName = serverInput.value.trim();
  if (!serverName) return;

  if (!currentSettings.trustedServers.includes(serverName)) {
    currentSettings.trustedServers.push(serverName);
    renderServerChips();
    saveSettings();
  }
  
  serverInput.value = "";
  serverInput.focus();
}

// 刪除伺服器
function removeServer(serverName) {
  currentSettings.trustedServers = currentSettings.trustedServers.filter(s => s !== serverName);
  renderServerChips();
  saveSettings();
}

// 事件監聽
document.addEventListener("DOMContentLoaded", loadSettings);

autoApproveToggle.addEventListener("change", (e) => {
  currentSettings.autoApprove = e.target.checked;
  saveSettings();
});

// 工具事件
addToolBtn.addEventListener("click", addTool);
toolInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTool();
});

// 伺服器事件
addServerBtn.addEventListener("click", addServer);
serverInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addServer();
});

resetBtn.addEventListener("click", () => {
  if (confirm("您確定要將信任工具與伺服器清單重設為預設值嗎？")) {
    currentSettings.trustedTools = [...DEFAULT_TRUSTED_TOOLS];
    currentSettings.trustedServers = [...DEFAULT_TRUSTED_SERVERS];
    renderAllChips();
    saveSettings();
  }
});
