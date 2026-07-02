var ApprovalHelperClicker = (() => {
  const DEFAULT_RETRY_DELAYS = Object.freeze([100, 400, 800, 1500, 2500, 4000, 6000, 9000, 12000, 16000, 20000, 25000, 30000]);

  function clickWithRetry({
    dialog,
    findButton,
    isEnabled,
    click,
    delays = DEFAULT_RETRY_DELAYS,
    onSuccess,
    onExhausted
  }) {
    let completed = false;

    delays.forEach((delay, index) => {
      setTimeout(() => {
        if (completed) return;
        if (!document.body.contains(dialog)) {
          completed = true;
          onExhausted?.("dialog_removed");
          return;
        }

        const button = findButton(dialog);
        if (button && isEnabled(button)) {
          completed = true;
          onSuccess?.(button, { index, delay });
          click(button);
          return;
        }

        if (index === delays.length - 1) {
          completed = true;
          onExhausted?.("button_unavailable");
        }
      }, delay);
    });
  }

  return {
    DEFAULT_RETRY_DELAYS,
    clickWithRetry
  };
})();
