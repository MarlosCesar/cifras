// ================ DOM CACHE ================
const DOM = {
  tabsContainer: document.getElementById('tabs-container'),
  tabsList: document.getElementById('tabs-list'),
  imageList: document.getElementById('image-list'),
  fileInput: document.getElementById('file-input'),
  openFileDialogButton: document.getElementById('open-file-dialog'),
  openCloudFolderButton: document.getElementById('open-cloud-folder'),
  deleteSelectedBtn: document.getElementById('delete-selected-btn'),
  clearSelectionBtn: document.getElementById('clear-selection-btn'),
  selectAllBtn: document.getElementById('select-all-btn'),
  selectionControls: document.getElementById('selection-controls'),
  floatControls: document.getElementById('float-controls'),
  syncBtn: document.getElementById('sync-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  loadingSpinner: document.getElementById('loading-spinner'),
  statusMessage: document.getElementById('status-message'),
  selectedPopup: document.getElementById('selected-popup'),
  nightModeBtn: document.getElementById('night-mode-btn'),
  nightModeIcon: document.getElementById('night-mode-icon'),
  popupBg: document.getElementById('popup-bg'),
  tabName: document.getElementById('tabName'),
  addTabBtn: document.getElementById('addTabBtn'),
  cancelTabBtn: document.getElementById('cancelTabBtn'),
  body: document.body,
};

// ================ CONSTANTES E CONFIGURAÇÕES ================
const DEFAULT_TABS = [
  { id: 'domingo_manha', name: 'Domingo Manhã', removable: false },
  { id: 'domingo_noite', name: 'Domingo Noite', removable: false },
  { id: 'segunda', name: 'Segunda', removable: false },
  { id: 'quarta', name: 'Quarta', removable: false },
  { id: 'culto_jovem', name: 'Culto Jovem', removable: false }
];

const DB_CONFIG = {
  name: 'CifrasDB',
  version: 1,
  stores: {
    images: 'images',
    state: 'state'
  }
};

// ================ ESTADO DA APLICAÇÃO ================
let appState = {
  userTabs: [],
  cifrasByTab: {},
  selectedTab: DEFAULT_TABS[0].id,
  selectedImages: new Map(), // Mapeia tabId -> Set de índices selecionados
  isSelectionMode: false,
  dragState: {
    isDragging: false,
    startIndex: null,
    sourceTab: null
  },
  darkMode: false
};

// ================ INICIALIZAÇÃO ================
document.addEventListener('DOMContentLoaded', async () => {
  await initializeDB();
  loadState();
  setupEventListeners();
  renderTabs();
  renderCifras();
  applyDarkMode();
});

// ================ INDEXEDDB HELPERS ================
async function initializeDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DB_CONFIG.stores.images)) {
        db.createObjectStore(DB_CONFIG.stores.images, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(DB_CONFIG.stores.state)) {
        db.createObjectStore(DB_CONFIG.stores.state, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

async function dbOperation(storeName, operation, data) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);
    request.onsuccess = (event) => {
      const db = event.target.result;
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let req;
      switch (operation) {
        case 'get': req = store.get(data.key); break;
        case 'getAll': req = store.getAll(); break;
        case 'put': req = store.put(data); break;
        case 'delete': req = store.delete(data.key); break;
        default: reject(new Error('Operação inválida'));
      }
      req.onsuccess = () => resolve(req.result);
      req.onerror = (event) => reject(event.target.error);
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

// ================ GERENCIAMENTO DE ESTADO ================
function loadState() {
  try {
    const savedState = JSON.parse(localStorage.getItem('cifrasAppState'));
    if (savedState) {
      appState.userTabs = savedState.userTabs || [];
      appState.cifrasByTab = savedState.cifrasByTab || {};
      appState.selectedTab = savedState.selectedTab || DEFAULT_TABS[0].id;
      appState.darkMode = savedState.darkMode === true;
      getAllTabIds().forEach(tabId => {
        if (!appState.selectedImages.has(tabId)) {
          appState.selectedImages.set(tabId, new Set());
        }
      });
    } else {
      getAllTabIds().forEach(tabId => {
        if (!appState.selectedImages.has(tabId)) {
          appState.selectedImages.set(tabId, new Set());
        }
      });
    }
  } catch (e) {
    console.error('Erro ao carregar estado:', e);
  }
}

function saveState() {
  const stateToSave = {
    userTabs: appState.userTabs,
    cifrasByTab: appState.cifrasByTab,
    selectedTab: appState.selectedTab,
    darkMode: appState.darkMode
  };
  localStorage.setItem('cifrasAppState', JSON.stringify(stateToSave));
  dbOperation(DB_CONFIG.stores.state, 'put', { key: 'appState', ...stateToSave }).catch(console.error);
}

function getAllTabIds() {
  return [...DEFAULT_TABS, ...appState.userTabs].map(tab => tab.id);
}

// ================ RENDERIZAÇÃO ================
function renderTabs() {
  DOM.tabsList.innerHTML = '';
  DEFAULT_TABS.forEach(tab => DOM.tabsList.appendChild(createTabElement(tab)));
  appState.userTabs.forEach(tab => DOM.tabsList.appendChild(createTabElement(tab, true)));
  const addBtn = document.createElement('li');
  addBtn.className = 'tab add-tab';
  addBtn.innerHTML = '<span aria-hidden="true">+</span><span class="sr-only">Adicionar nova categoria</span>';
  addBtn.onclick = showAddTabDialog;
  DOM.tabsList.appendChild(addBtn);
  updateSelectionControls();
}

function createTabElement(tab, isUserTab = false) {
  const li = document.createElement('li');
  li.className = `tab ${isUserTab ? 'user-tab' : ''} ${appState.selectedTab === tab.id ? 'selected' : ''}`;
  li.setAttribute('role', 'tab');
  li.setAttribute('aria-selected', appState.selectedTab === tab.id);
  li.setAttribute('aria-controls', `${tab.id}-panel`);
  li.dataset.id = tab.id;
  const nameSpan = document.createElement('span');
  nameSpan.textContent = tab.name;
  li.appendChild(nameSpan);
  if (isUserTab) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = '<span aria-hidden="true">×</span><span class="sr-only">Remover aba</span>';
    closeBtn.onclick = (e) => { e.stopPropagation(); removeTab(tab.id); };
    li.appendChild(closeBtn);
  }
  li.onclick = () => selectTab(tab.id);
  return li;
}

function renderCifras() {
  DOM.imageList.innerHTML = '';
  const currentTabId = appState.selectedTab;
  const cifras = appState.cifrasByTab[currentTabId] || [];
  if (cifras.length === 0) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'Nenhuma cifra nesta aba.';
    DOM.imageList.appendChild(emptyState);
    return;
  }
  cifras.forEach((cifra, index) => {
    const isSelected = appState.selectedImages.get(currentTabId).has(index);
    const cifraElement = createCifraElement(cifra, index, isSelected);
    DOM.imageList.appendChild(cifraElement);
  });
}

function createCifraElement(cifra, index, isSelected = false) {
  const container = document.createElement('div');
  container.className = `cifra-thumb ${isSelected ? 'selected' : ''}`;
  container.dataset.index = index;
  container.setAttribute('role', 'checkbox');
  container.setAttribute('aria-checked', isSelected);
  container.tabIndex = 0;
  loadCifraImage(cifra).then(imgUrl => {
    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = cifra.name || `Cifra ${index + 1}`;
    container.appendChild(img);
  }).catch(console.error);
  const nameSpan = document.createElement('span');
  nameSpan.textContent = cifra.name || cifra.replace(/\.[^/.]+$/, '');
  container.appendChild(nameSpan);
  setupCifraInteractions(container, index);
  return container;
}

async function loadCifraImage(cifra) {
  if (typeof cifra === 'string') {
    const blobObj = await dbOperation(DB_CONFIG.stores.images, 'get', { key: `${appState.selectedTab}:${cifra}` });
    if (!blobObj) return '';
    return URL.createObjectURL(blobObj.blob || blobObj);
  }
  return URL.createObjectURL(cifra);
}

function setupCifraInteractions(element, index) {
  let pressTimer = null;
  const currentTabId = appState.selectedTab;
  let lastTapTime = 0, tapTimeout = null;
  element.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    pressTimer = setTimeout(() => {
      appState.isSelectionMode = true;
      toggleSelectCifra(currentTabId, index, element);
    }, 500);
  });
  element.addEventListener('mouseup', () => {
    clearTimeout(pressTimer);
    if (!appState.isSelectionMode) return;
  });
  element.addEventListener('mouseleave', () => clearTimeout(pressTimer));
  element.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) return;
    pressTimer = setTimeout(() => {
      appState.isSelectionMode = true;
      toggleSelectCifra(currentTabId, index, element);
    }, 500);
  }, { passive: true });
  element.addEventListener('touchend', (e) => {
    clearTimeout(pressTimer);
    if (!appState.isSelectionMode) {
      const currentTime = new Date().getTime();
      if (currentTime - lastTapTime < 400) {
        clearTimeout(tapTimeout);
        openFullscreenView(element.querySelector('img').src, element.textContent);
      }
      lastTapTime = currentTime;
      tapTimeout = setTimeout(() => { lastTapTime = 0; }, 450);
    }
  }, { passive: true });
  element.addEventListener('dblclick', () => {
    if (!appState.isSelectionMode) {
      openFullscreenView(element.querySelector('img').src, element.textContent);
    }
  });
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSelectCifra(currentTabId, index, element);
    }
  });
}

// ================ GERENCIAMENTO DE ABAS ================
function selectTab(tabId) {
  appState.selectedTab = tabId;
  appState.isSelectionMode = false;
  saveState();
  renderTabs();
  renderCifras();
}

function showAddTabDialog() {
  DOM.popupBg.style.display = '';
  DOM.tabName.value = '';
  DOM.tabName.focus();
}

function closeAddTabDialog() {
  DOM.popupBg.style.display = 'none';
}

function addTab() {
  const name = DOM.tabName.value.trim();
  if (!name) {
    showStatus('Por favor, insira um nome para a aba');
    return;
  }
  const id = `user_${Date.now()}`;
  appState.userTabs.push({ id, name, removable: true });
  appState.cifrasByTab[id] = [];
  appState.selectedImages.set(id, new Set());
  saveState();
  renderTabs();
  closeAddTabDialog();
  showStatus(`Aba "${name}" adicionada`);
}

function removeTab(tabId) {
  if (!confirm('Tem certeza que deseja remover esta aba e todas as suas cifras?')) return;
  appState.userTabs = appState.userTabs.filter(tab => tab.id !== tabId);
  delete appState.cifrasByTab[tabId];
  appState.selectedImages.delete(tabId);
  if (appState.selectedTab === tabId) {
    appState.selectedTab = DEFAULT_TABS[0].id;
  }
  saveState();
  renderTabs();
  renderCifras();
  showStatus('Aba removida');
}

// ================ GERENCIAMENTO DE CIFRAS ================
function toggleSelectCifra(tabId, index, element) {
  const selectedSet = appState.selectedImages.get(tabId);
  if (selectedSet.has(index)) {
    selectedSet.delete(index);
    element.classList.remove('selected');
    element.setAttribute('aria-checked', 'false');
  } else {
    selectedSet.add(index);
    element.classList.add('selected');
    element.setAttribute('aria-checked', 'true');
  }
  updateSelectionControls();
  showSelectedCount(selectedSet.size);
}

function selectAllCifras() {
  const currentTabId = appState.selectedTab;
  const cifras = appState.cifrasByTab[currentTabId] || [];
  const selectedSet = appState.selectedImages.get(currentTabId);
  cifras.forEach((_, index) => selectedSet.add(index));
  renderCifras();
  updateSelectionControls();
  showSelectedCount(selectedSet.size);
}

function clearSelection() {
  const currentTabId = appState.selectedTab;
  appState.selectedImages.get(currentTabId).clear();
  appState.isSelectionMode = false;
  renderCifras();
  updateSelectionControls();
  showSelectedCount(0);
}

async function deleteSelectedCifras() {
  const currentTabId = appState.selectedTab;
  const selectedSet = appState.selectedImages.get(currentTabId);
  const cifras = appState.cifrasByTab[currentTabId] || [];
  if (selectedSet.size === 0) return;
  if (!confirm(`Excluir ${selectedSet.size} cifra(s) selecionada(s)?`)) return;
  showLoading(true);
  try {
    const deletePromises = Array.from(selectedSet).map(index => {
      const cifra = cifras[index];
      if (typeof cifra === 'string') {
        return dbOperation(DB_CONFIG.stores.images, 'delete', { key: `${currentTabId}:${cifra}` });
      }
      return Promise.resolve();
    });
    await Promise.all(deletePromises);
    appState.cifrasByTab[currentTabId] = cifras.filter((_, index) => !selectedSet.has(index));
    selectedSet.clear();
    appState.isSelectionMode = false;
    saveState();
    renderCifras();
    updateSelectionControls();
    showStatus(`${selectedSet.size} cifra(s) excluída(s)`);
  } catch (error) {
    console.error('Erro ao excluir cifras:', error);
    showStatus('Erro ao excluir cifras');
  } finally {
    showLoading(false);
  }
}

// ================ IMPORTAR CIFRAS ================
function setupFileInput() {
  DOM.fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    showLoading(true);
    try {
      const currentTabId = appState.selectedTab;
      const cifras = appState.cifrasByTab[currentTabId] || [];
      for (const file of files) {
        const existingIndex = cifras.findIndex(c => typeof c === 'string' ? c === file.name : c.name === file.name);
        if (existingIndex === -1) {
          await dbOperation(DB_CONFIG.stores.images, 'put', {
            key: `${currentTabId}:${file.name}`,
            blob: file
          });
          cifras.push(file.name);
        }
      }
      appState.cifrasByTab[currentTabId] = cifras;
      saveState();
      renderCifras();
      showStatus(`${files.length} cifra(s) adicionada(s)`);
    } catch (error) {
      console.error('Erro ao importar cifras:', error);
      showStatus('Erro ao importar cifras');
    } finally {
      showLoading(false);
      DOM.fileInput.value = '';
    }
  });
}

// ================ MODO NOTURNO ================
function toggleNightMode() {
  appState.darkMode = !appState.darkMode;
  saveState();
  applyDarkMode();
}

function applyDarkMode() {
  if (!DOM.nightModeIcon) return;
  if (appState.darkMode) {
    DOM.body.classList.add('dark-mode');
    DOM.nightModeIcon.classList.remove('fa-moon');
    DOM.nightModeIcon.classList.add('fa-sun');
  } else {
    DOM.body.classList.remove('dark-mode');
    DOM.nightModeIcon.classList.remove('fa-sun');
    DOM.nightModeIcon.classList.add('fa-moon');
  }
}

// ================ UI HELPERS ================
function showLoading(show) {
  DOM.loadingSpinner.style.display = show ? '' : 'none';
}

function showStatus(message) {
  DOM.statusMessage.textContent = message;
  DOM.statusMessage.style.display = '';
  setTimeout(() => {
    DOM.statusMessage.style.display = 'none';
  }, 3000);
}

function showSelectedCount(count) {
  if (!DOM.selectedPopup) return;
  if (count > 0) {
    DOM.selectedPopup.textContent = `${count} selecionada${count > 1 ? 's' : ''}`;
    DOM.selectedPopup.style.display = '';
  } else {
    DOM.selectedPopup.style.display = 'none';
  }
}

function updateSelectionControls() {
  const currentTabId = appState.selectedTab;
  const selectedCount = appState.selectedImages.get(currentTabId).size;
  const totalCount = appState.cifrasByTab[currentTabId]?.length || 0;
  if (DOM.selectionControls && DOM.selectAllBtn) {
    DOM.selectionControls.style.display = selectedCount > 0 ? '' : 'none';
    DOM.selectAllBtn.style.display = (selectedCount === totalCount || totalCount === 0) ? 'none' : '';
  }
}

// ================ FULLSCREEN API (NATIVO) ================
function openFullscreenView(imageSrc, imageName) {
  const overlay = document.createElement('div');
  overlay.className = 'fullscreen-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Visualizando: ${imageName}`);
  overlay.style.position = 'fixed';
  overlay.style.inset = 0;
  overlay.style.background = 'rgba(0,0,0,0.95)';
  overlay.style.zIndex = 2000;
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.cursor = 'zoom-out';

  const img = document.createElement('img');
  img.src = imageSrc;
  img.alt = imageName;
  img.style.maxWidth = '100vw';
  img.style.maxHeight = '100vh';
  img.style.objectFit = 'contain';
  img.style.boxShadow = '0 0 64px rgba(0,0,0,0.6)';
  img.style.cursor = 'grab';
  img.tabIndex = 0;

  // Zoom e arraste
  let scale = 1;
  let translateX = 0, translateY = 0;
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let imgStart = { x: 0, y: 0 };
  let initialPinchDistance = null;
  let lastScale = 1;
  let originX = 0.5, originY = 0.5;

  function updateTransform() {
    img.style.transformOrigin = `${originX * 100}% ${originY * 100}%`;
    img.style.transform = `scale(${scale}) translate(${translateX / scale}px, ${translateY / scale}px)`;
  }

  // Fullscreen nativo
  if (overlay.requestFullscreen) overlay.requestFullscreen();
  else if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();

  // Mouse: zoom centralizado e arraste
  img.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = img.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    originX = mouseX / rect.width;
    originY = mouseY / rect.height;
    const prevScale = scale;
    if (-e.deltaY > 0) scale = Math.min(scale * 1.1, 5);
    else scale = Math.max(scale / 1.1, 1);
    if (scale !== prevScale) {
      translateX = (translateX - (originX - 0.5) * rect.width) * (scale / prevScale) + (originX - 0.5) * rect.width;
      translateY = (translateY - (originY - 0.5) * rect.height) * (scale / prevScale) + (originY - 0.5) * rect.height;
    }
    if (scale === 1) {
      translateX = 0;
      translateY = 0;
      originX = 0.5;
      originY = 0.5;
    }
    updateTransform();
  });

  img.addEventListener('mousedown', (e) => {
    if (scale === 1) return;
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    imgStart = { x: translateX, y: translateY };
    img.style.cursor = 'grabbing';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = imgStart.x + (e.clientX - dragStart.x);
    translateY = imgStart.y + (e.clientY - dragStart.y);
    updateTransform();
  });
  overlay.addEventListener('mouseup', () => {
    isDragging = false;
    img.style.cursor = 'grab';
  });
  overlay.addEventListener('mouseleave', () => {
    isDragging = false;
    img.style.cursor = 'grab';
  });

  // Mobile: pinch/drag, impede fechar ao pinçar
  let lastTapTime = 0, tapTimeout = null;
  img.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      initialPinchDistance = Math.hypot(
        e.touches[1].pageX - e.touches[0].pageX,
        e.touches[1].pageY - e.touches[0].pageY
      );
      lastScale = scale;
      const rect = img.getBoundingClientRect();
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      originX = centerX / rect.width;
      originY = centerY / rect.height;
    } else if (e.touches.length === 1) {
      isDragging = true;
      dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      imgStart = { x: translateX, y: translateY };
    }
    e.preventDefault();
  }, { passive: false });

  img.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && initialPinchDistance) {
      const currentPinchDistance = Math.hypot(
        e.touches[1].pageX - e.touches[0].pageX,
        e.touches[1].pageY - e.touches[0].pageY
      );
      let newScale = lastScale * (currentPinchDistance / initialPinchDistance);
      newScale = Math.max(1, Math.min(newScale, 5));
      scale = newScale;
      updateTransform();
      e.preventDefault();
    } else if (e.touches.length === 1 && isDragging) {
      translateX = imgStart.x + (e.touches[0].clientX - dragStart.x);
      translateY = imgStart.y + (e.touches[0].clientY - dragStart.y);
      updateTransform();
      e.preventDefault();
    }
  }, { passive: false });

  img.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      isDragging = false;
      initialPinchDistance = null;
    }
  });

  // Fechar fullscreen: duplo clique/double tap no overlay (não na imagem!)
  overlay.addEventListener('dblclick', (e) => {
    if (e.target === overlay) closeFullscreen();
  });
  overlay.addEventListener('touchend', (e) => {
    if (e.target !== overlay) return;
    const currentTime = new Date().getTime();
    if (currentTime - lastTapTime < 400) {
      clearTimeout(tapTimeout);
      closeFullscreen();
    }
    lastTapTime = currentTime;
    tapTimeout = setTimeout(() => { lastTapTime = 0; }, 450);
  });

  // Fechar com ESC
  document.addEventListener('keydown', function escListener(e) {
    if (e.key === 'Escape') {
      closeFullscreen();
      document.removeEventListener('keydown', escListener);
    }
  });

  // Sai do fullscreen se o usuário usar ESC nativo (ex: F11 ou gesto mobile)
  document.addEventListener('fullscreenchange', function fsListener() {
    if (!document.fullscreenElement && document.body.contains(overlay)) {
      closeFullscreen();
      document.removeEventListener('fullscreenchange', fsListener);
    }
  });

  function closeFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
    URL.revokeObjectURL(imageSrc);
  }

  overlay.appendChild(img);
  document.body.appendChild(overlay);
  img.focus();
}

// ================ CONFIGURAÇÃO DE EVENTOS ================
function setupEventListeners() {
  if (DOM.addTabBtn) DOM.addTabBtn.addEventListener('click', addTab);
  if (DOM.cancelTabBtn) DOM.cancelTabBtn.addEventListener('click', closeAddTabDialog);
  if (DOM.tabName) DOM.tabName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTab();
    if (e.key === 'Escape') closeAddTabDialog();
  });
  if (DOM.selectAllBtn) DOM.selectAllBtn.addEventListener('click', selectAllCifras);
  if (DOM.clearSelectionBtn) DOM.clearSelectionBtn.addEventListener('click', clearSelection);
  if (DOM.deleteSelectedBtn) DOM.deleteSelectedBtn.addEventListener('click', deleteSelectedCifras);
  if (DOM.openFileDialogButton) DOM.openFileDialogButton.addEventListener('click', () => {
    DOM.fileInput.click();
  });
  setupFileInput();
  if (DOM.openCloudFolderButton) DOM.openCloudFolderButton.addEventListener('click', () => {
    window.open('https://1drv.ms/f/c/a71268bf66931c02/EpYyUsypAQhGgpWC9YuvE54BD_o9NX9tRar0piSzq4V4Xg', '_blank');
    showStatus('Abrindo pasta do OneDrive em uma nova aba');
  });
  if (DOM.nightModeBtn) DOM.nightModeBtn.addEventListener('click', toggleNightMode);
  if (DOM.syncBtn) DOM.syncBtn.setAttribute('title', 'Alternar Modo Noturno');
  if (DOM.settingsBtn) DOM.settingsBtn.addEventListener('click', () => {
    showStatus('Configurações em desenvolvimento');
  });
}
