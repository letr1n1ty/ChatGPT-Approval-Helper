var ApprovalHelperDom = (() => {
  function getVisibleText(el) {
    return (el?.innerText || el?.textContent || "").trim();
  }

  function getAccessibleText(el) {
    return [
      getVisibleText(el),
      el?.getAttribute?.("aria-label") || "",
      el?.getAttribute?.("title") || ""
    ].join(" ").trim();
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function isButtonEnabled(button) {
    if (!button) return false;
    if (button.disabled) return false;
    if (button.getAttribute("aria-disabled") === "true") return false;

    const style = window.getComputedStyle(button);
    if (style.pointerEvents === "none") return false;

    const classList = Array.from(button.classList).map(className => className.toLowerCase());
    return !classList.some(className => className.includes("disabled") || className.includes("loading") || className.includes("wait"));
  }

  function simulateRealClick(element) {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(eventName => {
      element.dispatchEvent(new MouseEvent(eventName, eventInit));
    });

    element.click();
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  return {
    getVisibleText,
    getAccessibleText,
    normalizeText,
    isElementVisible,
    isButtonEnabled,
    simulateRealClick,
    escapeHTML
  };
})();
