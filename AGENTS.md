# AGENTS.md

## Project Overview

ChatGPT Approval Helper is a Manifest V3 browser extension that assists with approval dialogs inside the ChatGPT web app. It detects supported permission prompts, highlights trusted requests, and can automatically approve requests that match user-managed allowlists.

The extension supports three approval categories:

- API tools, such as `apply_patch`, `exec_command`, and `git_status`
- MCP servers, such as `MCP Neverending Coding`
- ChatGPT connectors, such as `GitHub`

The project is intentionally small and client-side. It does not require a build step, a backend service, or external runtime dependencies.

## Repository Structure

```text
.
├── manifest.json          # Chrome extension manifest, Manifest V3
├── content.js             # Single approval scanner, router, detectors, badge, and approval handling
├── options.html           # Full settings page
├── options.js             # Shared settings logic for options and popup UI
├── popup.html             # Extension popup quick settings UI
├── shared/                # Shared defaults, storage, DOM, and click retry helpers
├── icons/                 # Extension icons
└── AGENTS.md              # Maintenance instructions for coding agents
```

## Runtime Model

The extension injects one approval scanner into ChatGPT pages:

- `content.js` owns DOM scanning, approval classification, badge rendering, keyboard approval, and auto-approval retry handling.
- Approval prompts are routed by detector priority: connector first, then MCP server, then API tool, then unknown review-only prompts.
- Shared helpers under `shared/` provide defaults, settings storage, DOM traversal, robust clicking, and retry behavior.
- Approval is only automatic when `autoApprove` is enabled and the detected target is present in the matching allowlist.

The relevant storage keys are:

```js
{
  autoApprove: boolean,
  trustedTools: string[],
  trustedServers: string[],
  trustedConnectors: string[]
}
```

## Development Guidelines

### General Principles

- Keep the extension dependency-free unless there is a strong reason to add tooling.
- Prefer small, readable JavaScript over framework-based abstractions.
- Preserve Manifest V3 compatibility.
- Avoid `eval`, remote code execution, dynamic script injection from remote sources, and unnecessary permissions.
- Do not add broad host permissions unless they are required for a supported approval surface.
- Keep all approval logic explicit and allowlist-driven.

### DOM Detection

ChatGPT UI markup can change. DOM detection should therefore use resilient signals:

- visible dialog text
- accessible labels
- button text
- semantic dialog, modal, popover, and Radix dialog hints
- conservative parent traversal from visible approval buttons
- open shadow-root traversal when available

Avoid selectors that depend on unstable generated class names.

### Approval Routing

Approval classification must remain centralized in `content.js`.

Detector priority matters:

1. Connector approvals, such as GitHub authorization prompts
2. MCP server approvals
3. API tool approvals
4. Unknown prompts, which may be highlighted but must not be auto-approved

Do not reintroduce separate content-script scanners for individual connector types unless there is a hard technical constraint. Separate scanners can race against each other and misclassify the same approval dialog.

### Auto-Approval Rules

Automatic approval must remain policy-gated:

- API tool prompts must match `trustedTools`.
- MCP server prompts must match `trustedServers`.
- Connector prompts must match `trustedConnectors`.
- Global auto-approval must require `autoApprove === true`.

Do not introduce unconditional auto-click behavior.

### Background Tab Behavior

The scanner should not rely exclusively on `requestAnimationFrame`, because hidden documents may delay foreground rendering callbacks. Use foreground-friendly scheduling for visible tabs and a hidden-document fallback such as `queueMicrotask` or `setTimeout`.

Background tab auto-approval is best-effort. Content scripts can operate on page DOM, but browser throttling, tab discard, and ChatGPT rendering behavior can still delay approval until the tab becomes active again.

### UI Guidelines

The options page and popup should remain visually consistent:

- Tokyo Night-inspired dark color palette
- iOS-style grouped settings layout
- compact popup controls for the most common settings
- full settings page for complete allowlist management

When changing settings UI, update both `options.html` and `popup.html` if the same setting is exposed in both places.

### Persistence

Use `chrome.storage.local` as the source of truth inside the extension. LocalStorage fallbacks may exist only for local test environments where the Chrome extension APIs are unavailable.

### Logging

Approval logs may be stored locally for debugging and audit visibility. Logs must not be transmitted to external services.

### Security Expectations

This extension operates on permission dialogs. Changes should be reviewed carefully for overbroad approval behavior. When adding support for a new connector or prompt type, include a clearly scoped detection rule and a matching allowlist policy.

## Manual Testing

The project currently has no build step. Test manually with an unpacked extension:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the repository directory.
5. Open ChatGPT.
6. Trigger supported approval prompts.
7. Verify both manual and auto-approval behavior.
8. Verify options page and popup settings persist correctly.

Recommended checks:

- Auto-approve disabled: no prompt should be automatically approved.
- Auto-approve enabled, item absent from allowlist: prompt should not be automatically approved.
- Auto-approve enabled, item present in allowlist: prompt should be approved.
- GitHub connector approval should be classified as a Connector, not as an MCP server or API tool.
- Removing `GitHub` from `trustedConnectors` should prevent GitHub connector auto-approval.
- Popup and options page should reflect the same stored settings.
- Hidden/background tabs should schedule scans without relying only on `requestAnimationFrame`.

## Release Notes

When preparing a release, update:

- `manifest.json` version
- `README.md`, if user-facing behavior changed
- this file, if maintenance rules changed

Do not include personal workflow notes, local absolute paths, or user-specific configuration in repository documentation.
