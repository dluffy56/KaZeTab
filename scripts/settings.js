const SLOT_NAMES = ['morning', 'afternoon', 'evening', 'night'];
const SLOT_SELECT_IDS = {
  morning: 'Wallpaper-options-morning',
  afternoon: 'Wallpaper-options-afternoon',
  evening: 'Wallpaper-options-evening',
  night: 'Wallpaper-options-night'
};
const SLOT_INPUT_IDS = {
  morning: 'genre-input-morning',
  afternoon: 'genre-input-afternoon',
  evening: 'genre-input-evening',
  night: 'genre-input-night'
};
const SLOT_WRAPPER_IDS = {
  morning: 'typeagenre_morning',
  afternoon: 'typeagenre_afternoon',
  evening: 'typeagenre_evening',
  night: 'typeagenre_night'
};
const PRESET_VALUES = new Set(['coding', 'nature', 'anime', 'space']);

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (result) => resolve(result || {})));
}

function setStorage(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function removeStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

function normalizeCategory(value) {
  if (!value) return '';
  const trimmed = String(value).trim().toLowerCase();
  if (trimmed.startsWith('typeagenre')) return 'typeagenre';
  return trimmed;
}

function isGenreChoice(value) {
  return normalizeCategory(value) === 'typeagenre';
}

async function fetchWallpaper(category) {
  const query = encodeURIComponent(normalizeCategory(category) || 'anime');
  const url = `https://wallhaven.cc/api/v1/search?q=${query}&categories=111&purity=100&sorting=random&resolutions=1920x1080&ratios=16x9`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  if (!data.data || data.data.length === 0) {
    throw new Error('No wallpapers found in API response');
  }

  return data.data[0].path;
}

function toggleVisibility(element, visible) {
  if (!element) return;
  element.classList.toggle('hiddenc', !visible);
  element.classList.toggle('visible', visible);
}

function setMode(mode, form, customForm, modeSameBtn, modeDifferentBtn) {
  const isDifferent = mode === 'different';
  toggleVisibility(form, !isDifferent);
  toggleVisibility(customForm, isDifferent);
  modeSameBtn?.classList.toggle('active', !isDifferent);
  modeDifferentBtn?.classList.toggle('active', isDifferent);
}

function syncMainGenreVisibility(selectElement, genreWrapper) {
  toggleVisibility(genreWrapper, isGenreChoice(selectElement?.value));
}

function syncSlotGenreVisibility(slot) {
  const selectElement = document.getElementById(SLOT_SELECT_IDS[slot]);
  const wrapper = document.getElementById(SLOT_WRAPPER_IDS[slot]);
  toggleVisibility(wrapper, isGenreChoice(selectElement?.value));
}

function getGenreInputValue(inputId) {
  return normalizeCategory(document.getElementById(inputId)?.value || '');
}

async function saveDifferentMode() {
  const timeSlotCategories = {};
  const customGenres = {};

  for (const slot of SLOT_NAMES) {
    const selectElement = document.getElementById(SLOT_SELECT_IDS[slot]);
    const selectedValue = selectElement?.value || '';

    if (!selectedValue || selectedValue === 'select') {
      throw new Error(`Please select a wallpaper type for ${slot}.`);
    }

    if (isGenreChoice(selectedValue)) {
      const typedGenre = getGenreInputValue(SLOT_INPUT_IDS[slot]);
      if (!typedGenre) {
        throw new Error(`Please enter a genre for ${slot}.`);
      }
      timeSlotCategories[slot] = typedGenre;
      customGenres[slot] = typedGenre;
      continue;
    }

    timeSlotCategories[slot] = normalizeCategory(selectedValue);
    customGenres[slot] = '';
  }

  await setStorage({
    mode: 'different',
    timeBasedWallpaper: true,
    timeSlotCategories,
    customGenres
  });

  return chrome.runtime.sendMessage({ type: 'timeSlotsUpdated' });
}

async function saveSameMode() {
  const wallpaperSelect = document.getElementById('Wallpaper-options');
  const genreInput = document.getElementById('genre-input');
  const showBookmarksSwitch = document.getElementById('Show_Bookmakrs');
  const greetingsSwitch = document.getElementById('timebased_greetings');
  const timeBasedWallpaperSwitch = document.getElementById('timebased_wallpaper');

  if (!wallpaperSelect || wallpaperSelect.value === 'select') {
    throw new Error('Please select a wallpaper type!');
  }

  const rawType = normalizeCategory(wallpaperSelect.value);
  const resolvedCategory = isGenreChoice(rawType)
    ? normalizeCategory(genreInput?.value || '')
    : rawType;

  if (!resolvedCategory) {
    throw new Error('Please enter a genre before saving.');
  }

  const wallpaperUrl = await fetchWallpaper(resolvedCategory);
  const timeBasedWallpaper = !!timeBasedWallpaperSwitch?.checked;
  const baseSettings = {
    wallpaperType: rawType,
    wallpaperUrl,
    customGenre: isGenreChoice(rawType) ? resolvedCategory : '',
    timeBasedGreetings: !!greetingsSwitch?.checked,
    showBookmarks: !!showBookmarksSwitch?.checked,
    timeBasedWallpaper
  };

  if (timeBasedWallpaper) {
    const timeSlotCategories = {};
    const customGenres = {};

    for (const slot of SLOT_NAMES) {
      timeSlotCategories[slot] = resolvedCategory;
      customGenres[slot] = isGenreChoice(rawType) ? resolvedCategory : '';
    }

    await setStorage({
      ...baseSettings,
      mode: 'different',
      timeSlotCategories,
      customGenres
    });
    chrome.runtime.sendMessage({ type: 'timeSlotsUpdated' });
    return;
  }

  await removeStorage(['timeSlotCategories', 'customGenres']);
  await setStorage({
    ...baseSettings,
    mode: 'same'
  });
  chrome.runtime.sendMessage({ type: 'settingsUpdated' });
}

async function loadSavedSettings(form, customForm, modeSameBtn, modeDifferentBtn) {
  const result = await getStorage([
    'wallpaperType',
    'customGenre',
    'timeBasedGreetings',
    'timeBasedWallpaper',
    'showBookmarks',
    'mode',
    'timeSlotCategories',
    'customGenres'
  ]);

  const wallpaperSelect = document.getElementById('Wallpaper-options');
  const genreInput = document.getElementById('genre-input');
  const greetingsSwitch = document.getElementById('timebased_greetings');
  const timeBasedWallpaperSwitch = document.getElementById('timebased_wallpaper');
  const showBookmarksSwitch = document.getElementById('Show_Bookmakrs');
  const genreWrapper = document.getElementById('typeagenre');

  if (greetingsSwitch) {
    greetingsSwitch.checked = !!result.timeBasedGreetings;
  }

  if (timeBasedWallpaperSwitch) {
    timeBasedWallpaperSwitch.checked = !!result.timeBasedWallpaper;
  }

  if (showBookmarksSwitch) {
    showBookmarksSwitch.checked = result.showBookmarks !== false;
  }

  if (result.mode === 'different') {
    setMode('different', form, customForm, modeSameBtn, modeDifferentBtn);

    for (const slot of SLOT_NAMES) {
      const selectElement = document.getElementById(SLOT_SELECT_IDS[slot]);
      const inputElement = document.getElementById(SLOT_INPUT_IDS[slot]);
      const category = normalizeCategory(result.timeSlotCategories?.[slot]);
      const customValue = normalizeCategory(result.customGenres?.[slot]);

      if (!selectElement) {
        continue;
      }

      if (PRESET_VALUES.has(category)) {
        selectElement.value = category;
      } else if (category) {
        selectElement.value = `typeagenre_${slot}`;
        if (inputElement) {
          inputElement.value = customValue || category;
        }
      }

      syncSlotGenreVisibility(slot);
    }

    return;
  }

  setMode('same', form, customForm, modeSameBtn, modeDifferentBtn);

  if (wallpaperSelect) {
    wallpaperSelect.value = result.wallpaperType || 'select';
    if (result.wallpaperType === 'typeagenre' && genreInput) {
      genreInput.value = result.customGenre || '';
    }
    syncMainGenreVisibility(wallpaperSelect, genreWrapper);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settings-form');
  const customForm = document.getElementById('custom-settings-form');
  const modeSameBtn = document.getElementById('mode-same');
  const modeDifferentBtn = document.getElementById('mode-different');
  const wallpaperSelect = document.getElementById('Wallpaper-options');
  const mainGenreWrapper = document.getElementById('typeagenre');
  const showBookmarksSwitch = document.getElementById('Show_Bookmakrs');

  if (typeof chrome === 'undefined' || !chrome.storage || !form || !customForm || !wallpaperSelect) {
    console.error('Chrome extension APIs or required elements are not available');
    return;
  }

  showBookmarksSwitch?.addEventListener('change', () => {
    chrome.storage.local.set({ showBookmarks: showBookmarksSwitch.checked });
  });

  modeSameBtn?.addEventListener('click', () => {
    setMode('same', form, customForm, modeSameBtn, modeDifferentBtn);
  });

  modeDifferentBtn?.addEventListener('click', () => {
    setMode('different', form, customForm, modeSameBtn, modeDifferentBtn);
  });

  wallpaperSelect.addEventListener('change', () => {
    syncMainGenreVisibility(wallpaperSelect, mainGenreWrapper);
  });

  for (const slot of SLOT_NAMES) {
    const selectElement = document.getElementById(SLOT_SELECT_IDS[slot]);
    selectElement?.addEventListener('change', () => syncSlotGenreVisibility(slot));
  }

  customForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      await saveDifferentMode();
      alert('Wallpaper schedule saved! Open a new tab to see it live.');
      chrome.tabs.create({ url: 'chrome://newtab' });
    } catch (error) {
      console.error(error);
      alert('Error: ' + error.message);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      await saveSameMode();
      alert('Wallpaper settings saved!');
      chrome.tabs.create({ url: 'chrome://newtab' });
    } catch (error) {
      console.error(error);
      alert('Error: ' + error.message);
    }
  });

  try {
    await loadSavedSettings(form, customForm, modeSameBtn, modeDifferentBtn);
  } catch (error) {
    console.error('Error loading settings:', error);
  }
});
