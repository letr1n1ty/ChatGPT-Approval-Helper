const openOptionsButton = document.getElementById("open-options-btn");

if (openOptionsButton) {
  openOptionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}
