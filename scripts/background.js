const SLOT_NAMES = ['morning', 'afternoon', 'evening', 'night'];
const SLOT_SCHEDULES = {
  morning: { hour: 6, minute: 0 },
  afternoon: { hour: 12, minute: 0 },
  evening: { hour: 18, minute: 0 },
  night: { hour: 22, minute: 0 }
};

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (result) => resolve(result || {})));
}

function setStorage(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function clearAlarms() {
  return new Promise((resolve) => chrome.alarms.clearAll(resolve));
}

function normalizeCategory(value) {
  if (!value) return '';
  const trimmed = String(value).trim().toLowerCase();
  if (trimmed.startsWith('typeagenre')) return 'typeagenre';
  return trimmed;
}

function getSlotForHour(hour) {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

function getCurrentSlot() {
  return getSlotForHour(new Date().getHours());
}

function getNextTriggerTime(hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime();
}

function shouldUseScheduledWallpapers(state) {
  return state.mode === 'different' || !!state.timeBasedWallpaper || Object.keys(state.timeSlotCategories || {}).length > 0;
}

function hasWallpaperPreference(state) {
  return !!(
    normalizeCategory(state.wallpaperType) ||
    normalizeCategory(state.customGenre) ||
    Object.keys(state.timeSlotCategories || {}).length > 0
  );
}

function resolveCategoryForSlot(state, slot) {
  if (shouldUseScheduledWallpapers(state)) {
    return normalizeCategory(
      (state.customGenres && state.customGenres[slot]) ||
      (state.timeSlotCategories && state.timeSlotCategories[slot]) ||
      state.customGenre ||
      state.wallpaperType ||
      'space'
    );
  }

  if (normalizeCategory(state.wallpaperType) === 'typeagenre') {
    return normalizeCategory(state.customGenre || 'anime');
  }

  return normalizeCategory(state.wallpaperType || 'anime');
}

async function fetchWallpaperCategory(category) {
  const query = encodeURIComponent(normalizeCategory(category) || 'anime');
  const url = `https://wallhaven.cc/api/v1/search?q=${query}&categories=111&purity=100&sorting=random&resolutions=1920x1080&ratios=16x9`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Fetch failed: ' + response.status);
  }

  const json = await response.json();
  return json?.data?.[0]?.path || null;
}

async function refreshWallpaperForSlot(slot, syncCurrentWallpaper) {
  const state = await getStorage([
    'mode',
    'timeBasedWallpaper',
    'timeSlotCategories',
    'customGenres',
    'wallpaperType',
    'customGenre'
  ]);

  const category = resolveCategoryForSlot(state, slot);
  const imageUrl = await fetchWallpaperCategory(category);

  if (!imageUrl) {
    throw new Error('No wallpaper found for ' + category);
  }

  const updates = {
    [`wallpaper_${slot}`]: imageUrl
  };

  if (syncCurrentWallpaper) {
    updates.wallpaperUrl = imageUrl;
  }

  await setStorage(updates);
  return imageUrl;
}

async function preloadWallpapers() {
  const currentSlot = getCurrentSlot();

  for (const slot of SLOT_NAMES) {
    try {
      await refreshWallpaperForSlot(slot, slot === currentSlot);
    } catch (error) {
      console.warn('Preload failed for', slot, error);
    }
  }
}

async function syncCurrentWallpaperFromCache() {
  const currentSlot = getCurrentSlot();
  const key = `wallpaper_${currentSlot}`;
  const result = await getStorage([key, 'wallpaperUrl']);

  if (result[key]) {
    await setStorage({ wallpaperUrl: result[key] });
  }
}

async function scheduleSlotAlarms() {
  await clearAlarms();

  for (const [slot, config] of Object.entries(SLOT_SCHEDULES)) {
    chrome.alarms.create(slot, {
      when: getNextTriggerTime(config.hour, config.minute),
      periodInMinutes: 24 * 60
    });
  }
}

async function syncScheduling() {
  const state = await getStorage(['mode', 'timeBasedWallpaper', 'timeSlotCategories']);

  if (!shouldUseScheduledWallpapers(state)) {
    await clearAlarms();
    return;
  }

  await scheduleSlotAlarms();
  await syncCurrentWallpaperFromCache();
}

async function handleTimeSlotRefresh() {
  const state = await getStorage(['wallpaperType', 'customGenre', 'timeSlotCategories']);

  if (!hasWallpaperPreference(state)) {
    await clearAlarms();
    return;
  }

  await preloadWallpapers();
  await syncScheduling();
}

chrome.runtime.onInstalled.addListener(() => {
  handleTimeSlotRefresh().catch((error) => console.error('Install sync failed', error));
});

chrome.runtime.onStartup.addListener(() => {
  handleTimeSlotRefresh().catch((error) => console.error('Startup sync failed', error));
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!SLOT_NAMES.includes(alarm.name)) {
    return;
  }

  try {
    await refreshWallpaperForSlot(alarm.name, alarm.name === getCurrentSlot());
  } catch (error) {
    console.error('Alarm handler error', error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'timeSlotsUpdated' || message.type === 'settingsUpdated') {
    handleTimeSlotRefresh()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'refreshCurrentWallpaper') {
    const currentSlot = getCurrentSlot();
    refreshWallpaperForSlot(currentSlot, true)
      .then((url) => sendResponse({ ok: true, url }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  if (
    changes.mode ||
    changes.timeBasedWallpaper ||
    changes.timeSlotCategories ||
    changes.customGenres
  ) {
    syncScheduling().catch((error) => console.error('Storage sync failed', error));
  }
});
