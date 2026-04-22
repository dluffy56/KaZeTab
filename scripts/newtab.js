const FALLBACK_FAVICON = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="%2399a1ad"/></svg>';
let bookmarkManager = null;

function scheduleIdleWork(callback) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout: 350 });
    return;
  }

  window.setTimeout(callback, 120);
}

function getStorage(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    } catch (error) {
      resolve({});
    }
  });
}

function setWallpaperUrl(url) {
  if (!url) return;

  const container = document.getElementById('wallpaper-container') || document.body;
  container.style.backgroundImage = `url("${url}")`;
  container.style.backgroundSize = 'cover';
  container.style.backgroundPosition = 'center';
  container.style.backgroundRepeat = 'no-repeat';
}

function getSlotForHour(hour) {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

async function loadWallpaperOnStart() {
  const result = await getStorage(['wallpaperUrl', 'timeSlotCategories', 'mode']);
  const slot = getSlotForHour(new Date().getHours());

  if (result.mode === 'different' && result.timeSlotCategories) {
    const key = `wallpaper_${slot}`;
    const slotWallpaper = await getStorage([key]);

    if (slotWallpaper[key]) {
      setWallpaperUrl(slotWallpaper[key]);
      return;
    }
  }

  if (result.wallpaperUrl) {
    setWallpaperUrl(result.wallpaperUrl);
  }
}

function showGreetingIfNeeded() {
  chrome.storage.local.get(['timeBasedGreetings'], (result) => {
    if (!result.timeBasedGreetings) return;

    const hour = new Date().getHours();
    const greeting = hour < 12
      ? 'Morning Champ!'
      : hour < 18
        ? 'Afternoon!'
        : hour <= 22
          ? 'Evening'
          : 'Night, Go Sleep!';

    const greetingDisplay = document.getElementById('greeting-text');
    if (greetingDisplay) {
      greetingDisplay.textContent = greeting;
    }
  });
}

class BookmarkManager {
  constructor() {
    this.loadingElement = document.getElementById('bookmarks-loading');
    this.bookmarksContainer = document.getElementById('bookmarks-list');
    this.init();
  }

  async init() {
    try {
      const tree = await chrome.bookmarks.getTree();
      const bookmarksBar = this.findBookmarksBar(tree[0]);

      if (bookmarksBar && bookmarksBar.children) {
        this.renderBookmarks(bookmarksBar.children);
      } else if (this.loadingElement) {
        this.loadingElement.textContent = 'No bookmarks found';
      }
    } catch (error) {
      console.error('Error fetching bookmarks:', error);
      if (this.loadingElement) {
        this.loadingElement.textContent = 'Error loading bookmarks';
      }
    }
  }

  findBookmarksBar(root) {
    if (!root.children) return null;

    for (const child of root.children) {
      if (child.title === 'Bookmarks bar' || child.title === 'Bookmarks Bar') {
        return child;
      }
    }

    return root.children[0] || null;
  }

  renderBookmarks(bookmarks) {
    if (!this.loadingElement || !this.bookmarksContainer) {
      return;
    }

    this.loadingElement.style.display = 'none';
    this.bookmarksContainer.style.display = 'flex';
    this.bookmarksContainer.innerHTML = '';

    bookmarks.forEach((bookmark) => {
      const element = this.createBookmarkElement(bookmark);
      if (element) {
        this.bookmarksContainer.appendChild(element);
      }
    });
  }

  createBookmarkElement(bookmark) {
    if (bookmark.url) {
      const link = document.createElement('a');
      link.href = bookmark.url;
      link.target = '_self';
      link.className = 'bookmark-item';

      const favicon = document.createElement('img');
      favicon.className = 'bookmark-favicon';
      favicon.loading = 'lazy';
      favicon.decoding = 'async';
      favicon.src = this.getFaviconUrl(bookmark.url);
      favicon.onerror = () => {
        favicon.src = FALLBACK_FAVICON;
      };

      const title = document.createElement('span');
      title.textContent = bookmark.title || 'Untitled';
      title.className = 'bookmark-title';

      link.appendChild(favicon);
      link.appendChild(title);
      return link;
    }

    if (bookmark.children) {
      const folder = document.createElement('span');
      folder.textContent = bookmark.title || 'Folder';
      folder.className = 'bookmark-folder';
      return folder;
    }

    return null;
  }

  getFaviconUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    } catch {
      return '';
    }
  }
}

function applyShowBookmarksSetting(show) {
  const bookmarksDiv = document.getElementById('bookmarks-container');
  if (!bookmarksDiv) return;
  bookmarksDiv.style.display = show ? 'flex' : 'none';

  if (show && !bookmarkManager) {
    scheduleIdleWork(() => {
      if (!bookmarkManager) {
        bookmarkManager = new BookmarkManager();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const result = await getStorage(['showBookmarks']);
  const showBookmarks = result.showBookmarks !== false;
  applyShowBookmarksSetting(showBookmarks);

  try {
    await loadWallpaperOnStart();
  } catch (error) {
    console.error('Error while loading wallpaper on start:', error);
  }

  try {
    showGreetingIfNeeded();
  } catch (error) {
    console.error('Greeting error', error);
  }

  const searchForm = document.getElementById('searchForm');
  const searchBox = document.getElementById('searchBox');

  if (searchForm && searchBox) {
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = searchBox.value.trim();

      if (!query) return;

      try {
        if (window.chrome && chrome.search && typeof chrome.search.query === 'function') {
          chrome.search.query({ text: query });
        } else {
          window.open('https://www.google.com/search?q=' + encodeURIComponent(query), '_blank');
        }
      } catch (error) {
        window.open('https://www.google.com/search?q=' + encodeURIComponent(query), '_blank');
      }
    });
  }

  if (showBookmarks) {
    scheduleIdleWork(() => {
      if (!bookmarkManager) {
        bookmarkManager = new BookmarkManager();
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'wallpaper-updated' && message.url) {
    setWallpaperUrl(message.url);
  }

  if (message.type === 'mode-changed') {
    loadWallpaperOnStart().catch((error) => console.error('Mode change reload failed', error));
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.showBookmarks) {
    applyShowBookmarksSetting(!!changes.showBookmarks.newValue);
  }

  const currentSlotKey = `wallpaper_${getSlotForHour(new Date().getHours())}`;

  if (changes.wallpaperUrl?.newValue) {
    setWallpaperUrl(changes.wallpaperUrl.newValue);
    return;
  }

  if (changes[currentSlotKey]?.newValue) {
    setWallpaperUrl(changes[currentSlotKey].newValue);
    return;
  }

  if (changes.mode || changes.timeSlotCategories || changes.timeBasedWallpaper) {
    loadWallpaperOnStart().catch((error) => console.error('Reload wallpaper failed', error));
  }
});
