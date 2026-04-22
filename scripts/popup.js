document.addEventListener('DOMContentLoaded', () => {
  const openSettingsBtn = document.getElementById('open-settings');
  const changeWallpaperBtn = document.getElementById('change-wallpaper');

  openSettingsBtn?.addEventListener('click', () => {
    if (chrome?.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage(() => {
        if (chrome.runtime.lastError) {
          chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
        }
      });
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    }
  });

  changeWallpaperBtn?.addEventListener('click', (event) => {
    event.preventDefault();

    chrome.runtime.sendMessage({ type: 'refreshCurrentWallpaper' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        alert('Could not refresh wallpaper right now.');
        return;
      }

      if (!response || !response.ok) {
        alert('Error: ' + (response?.error || 'Could not refresh wallpaper.'));
        return;
      }

      chrome.tabs.create({ url: 'chrome://newtab' });
    });
  });
});
