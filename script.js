// ======== Utilitários ========
const Utils = {
  removeFileExtension: filename => filename.replace(/\.[^/.]+$/, ""),
  showStatus: (message, duration = 3000) => {
    const el = document.getElementById('status-message');
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration);
  },
  debounce: (func, timeout = 300) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
  },
  objectURLCache: new Map(),
  revokeObjectURL: (url) => {
    if (Utils.objectURLCache.has(url)) {
      URL.revokeObjectURL(url);
      Utils.objectURLCache.delete(url);
    }
  },
  createObjectURL: (blob) => {
    const url = URL.createObjectURL(blob);
    Utils.objectURLCache.set(url, true);
    return url;
  }
};

// ======== IndexedDB =========
const DB_NAME = 'ImageSelectorDB';
const DB_VERSION = 2;
const STORE_IMAGES = 'images';
const STORE_METADATA = 'metadata';

const IndexedDBManager = {
  db: null,

  open: () => new Promise((resolve, reject) => {
    if (IndexedDBManager.db) {
      resolve(IndexedDBManager.db);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA, { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => {
      IndexedDBManager.db = event.target.result;
      resolve(IndexedDBManager.db);
    };
    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject(event.target.error);
    };
  }),

  addImageBlob: (imageName, blob) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_IMAGES], 'readwrite');
      const store = transaction.objectStore(STORE_IMAGES);
      store.put({ name: imageName, blob: blob }).onsuccess = resolve;
      store.put({ name: imageName, blob: blob }).onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  }),

  getImageBlob: (imageName) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_IMAGES], 'readonly');
      const store = transaction.objectStore(STORE_IMAGES);
      const request = store.get(imageName);
      request.onsuccess = (event) => resolve(event.target.result ? event.target.result.blob : null);
      request.onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  }),

  deleteImageBlob: (imageName) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_IMAGES], 'readwrite');
      const store = transaction.objectStore(STORE_IMAGES);
      const request = store.delete(imageName);
      request.onsuccess = resolve;
      request.onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  }),

  saveMetadata: (state) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_METADATA], 'readwrite');
      const store = transaction.objectStore(STORE_METADATA);
      const request = store.put({ id: 'appState', state: state });
      request.onsuccess = resolve;
      request.onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  }),

  loadMetadata: () => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_METADATA], 'readonly');
      const store = transaction.objectStore(STORE_METADATA);
      const request = store.get('appState');
      request.onsuccess = (event) => resolve(event.target.result ? event.target.result.state : null);
      request.onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  })
};

// ======= Estado do App =======
let tabs = [
  "Domingo Manhã", "Domingo Noite", "Segunda", "Quarta", "Culto Jovem", "Santa Ceia"
];
let userTabs = [];
let imageGalleryByTab = new Map();
let selectedImagesByTab = new Map();
let currentTab = tabs[0];
let isSelectionMode = false;

// ======= UI DOM =======
const DOM = {
  tabsContainer: document.getElementById('tabs-container'),
  imageList: document.getElementById('image-list'),
  fileInput: document.getElementById('file-input'),
  openFileDialogButton: document.getElementById('open-file-dialog'),
  deleteSelectedBtn: document.getElementById('delete-selected-btn'),
  clearSelectionBtn: document.getElementById('clear-selection-btn'),
  selectAllBtn: document.getElementById('select-all-btn'),
  floatControls: document.getElementById('float-controls'),
  darkModeToggle: document.getElementById('dark-mode-toggle'),
  loadingSpinner: document.getElementById('loading-spinner'),
  statusMessage: document.getElementById('status-message'),
  body: document.body
};

// ====== UI Functions ======
const UI = {
  showLoading: () => DOM.loadingSpinner.classList.add('active'),
  hideLoading: () => DOM.loadingSpinner.classList.remove('active'),

  createTabs: function () {
    DOM.tabsContainer.innerHTML = '';
    const allTabs = [...tabs, ...userTabs, "+"];

    allTabs.forEach((tab, idx) => {
      const isPlus = (tab === "+");
      const isUserTab = userTabs.includes(tab);

      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('tabindex', idx === 0 ? '0' : '-1');
      btn.setAttribute('aria-selected', currentTab === tab);
      btn.id = `tab-${tab.replace(/\s+/g, '-').toLowerCase()}`;
      btn.textContent = tab;

      if (isPlus) {
        btn.onclick = () => {
          let name = prompt("Nome da nova aba:");
          if (name) {
            name = name.trim();
            if (name.length > 0 && !tabs.includes(name) && !userTabs.includes(name) && name !== "+") {
              userTabs.push(name);
              imageGalleryByTab.set(name, []);
              selectedImagesByTab.set(name, new Set());
              currentTab = name;
              UI.createTabs();
              UI.updateTabsUI();
              UI.renderImages();
              StateManager.saveState();
            } else {
              Utils.showStatus("Nome de aba inválido ou já existente.");
            }
          }
        };
      } else {
        btn.onclick = () => TabManager.switchTab(tab);
        btn.onkeydown = (e) => TabManager.keyNav(e, tab, idx);

        if (isUserTab) {
          btn.style.position = "relative";
          const closeBtn = document.createElement('span');
          closeBtn.textContent = "×";
          closeBtn.title = "Remover aba";
          closeBtn.style.position = "absolute";
          closeBtn.style.right = "6px";
          closeBtn.style.top = "4px";
          closeBtn.style.color = "#ef4444";
          closeBtn.style.fontWeight = "bold";
          closeBtn.style.cursor = "pointer";
          closeBtn.style.display = "none";
          closeBtn.className = "close-tab-btn";
          closeBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Remover a aba "${tab}" e todas as suas cifras?`)) {
              imageGalleryByTab.delete(tab);
              selectedImagesByTab.delete(tab);
              userTabs = userTabs.filter(t => t !== tab);
              if (currentTab === tab) currentTab = tabs[0];
              UI.createTabs();
              UI.updateTabsUI();
              UI.renderImages();
              StateManager.saveState();
            }
          };
          btn.appendChild(closeBtn);

          btn.onmouseenter = () => (closeBtn.style.display = "block");
          btn.onmouseleave = () => (closeBtn.style.display = "none");
          btn.onfocus = () => (closeBtn.style.display = "block");
          btn.onblur = () => (closeBtn.style.display = "none");
        }
      }

      DOM.tabsContainer.appendChild(btn);
    });
  },

  updateTabsUI: function () {
    const allTabs = [...tabs, ...userTabs, "+"];
    const buttons = DOM.tabsContainer.querySelectorAll('.tab');
    buttons.forEach((btn, idx) => {
      const tab = allTabs[idx];
      const isActive = (tab === currentTab);
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive);
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
      const closeBtn = btn.querySelector('.close-tab-btn');
      if (closeBtn) {
        closeBtn.style.display = isActive ? "block" : "none";
      }
    });
  },

  renderImages: async function () {
    DOM.imageList.innerHTML = '';
    DOM.imageList.querySelectorAll('img[data-object-url]').forEach(img => {
      Utils.revokeObjectURL(img.dataset.objectUrl);
    });

    const imageNames = imageGalleryByTab.get(currentTab) || [];
    if (imageNames.length === 0) {
      const p = document.createElement('p');
      p.className = 'text-center text-gray-500 py-8';
      p.textContent = 'Nenhuma cifra adicionada.';
      DOM.imageList.appendChild(p);
    } else {
      for (const name of imageNames) {
        try {
          const blob = await IndexedDBManager.getImageBlob(name);
          if (blob) {
            DOM.imageList.appendChild(UI.createImageElement(name, blob));
          }
        } catch (error) {
          console.error(`Error loading image ${name}:`, error);
        }
      }
    }
    UI.updateSelectionUI();
  },

  createImageElement: (imageName, imageBlob) => {
    const container = document.createElement('div');
    container.className = 'image-container';
    container.setAttribute('draggable', 'true');
    container.setAttribute('tabindex', '0');
    container.setAttribute('role', 'checkbox');
    container.setAttribute('aria-checked', selectedImagesByTab.get(currentTab).has(imageName));
    container.dataset.name = imageName;

    if (selectedImagesByTab.get(currentTab).has(imageName)) {
      container.classList.add('selected');
    }

    const checkbox = document.createElement('div');
    checkbox.className = 'image-checkbox';
    if (selectedImagesByTab.get(currentTab).has(imageName)) {
      checkbox.classList.add('checked');
    }
    checkbox.onclick = (e) => {
      e.stopPropagation();
      ImageManager.toggleSelectImage(imageName, container);
    };

    const img = document.createElement('img');
    const objectURL = Utils.createObjectURL(imageBlob);
    img.src = objectURL;
    img.dataset.objectUrl = objectURL;
    img.alt = Utils.removeFileExtension(imageName);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'image-name';
    nameSpan.textContent = Utils.removeFileExtension(imageName);

    container.append(checkbox, img, nameSpan);

    // Long press/right click for selection
    let longPressTimer = null;
    let longPressed = false;

    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      longPressed = false;
      longPressTimer = setTimeout(() => {
        longPressed = true;
        if (!isSelectionMode) {
          ImageManager.enterSelectionMode();
          ImageManager.toggleSelectImage(imageName, container);
        }
      }, 400);
    });

    container.addEventListener('mouseup', (e) => {
      clearTimeout(longPressTimer);
      if (isSelectionMode && !longPressed && e.button === 0) {
        ImageManager.toggleSelectImage(imageName, container);
      }
      longPressed = false;
    });

    container.addEventListener('mouseleave', () => {
      clearTimeout(longPressTimer);
      longPressed = false;
    });

    // Touch events for mobile
    container.addEventListener('touchstart', (e) => {
      longPressed = false;
      longPressTimer = setTimeout(() => {
        longPressed = true;
        if (!isSelectionMode) {
          ImageManager.enterSelectionMode();
          ImageManager.toggleSelectImage(imageName, container);
        }
      }, 400);
    });

    container.addEventListener('touchend', (e) => {
      clearTimeout(longPressTimer);
      if (isSelectionMode && !longPressed) {
        ImageManager.toggleSelectImage(imageName, container);
      }
      longPressed = false;
    });

    // Double click for fullscreen
    container.ondblclick = () => {
      if (!isSelectionMode) {
        UI.openFullscreen(objectURL, Utils.removeFileExtension(imageName));
      }
    };

    // Drag and drop for reordering
    container.addEventListener('dragstart', (e) => {
      container.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', imageName);
    });

    container.addEventListener('dragend', () => {
      container.classList.remove('dragging');
      DOM.imageList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    return container;
  },

  updateSelectionUI: () => {
    const selectedCount = selectedImagesByTab.get(currentTab).size;
    const totalImages = imageGalleryByTab.get(currentTab).length;
    
    if (selectedCount > 0) {
      DOM.floatControls.classList.add('show');
      const allSelected = selectedCount === totalImages;
      DOM.selectAllBtn.querySelector('span').textContent = allSelected ? 'Desselecionar todas' : 'Selecionar todas';
      DOM.selectAllBtn.querySelector('i').className = allSelected ? 'far fa-square' : 'fas fa-check-square';
      Utils.showStatus(`${selectedCount} ${selectedCount === 1 ? 'cifra selecionada' : 'cifras selecionadas'}`);
    } else {
      DOM.floatControls.classList.remove('show');
    }
    DOM.selectAllBtn.style.display = totalImages <= 1 ? 'none' : 'flex';
  },

  openFullscreen: (src, alt) => {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-image';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Visualização da imagem ${alt}`);

    let scale = 1, posX = 0, posY = 0, dragging = false, startX = 0, startY = 0, lastTouchDist = null;

    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.tabIndex = 0;
    img.style.maxWidth = '100vw';
    img.style.maxHeight = '100vh';
    img.style.objectFit = 'contain';
    img.style.transition = 'transform 0.1s';
    img.style.cursor = 'zoom-in';

    overlay.appendChild(img);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Fechar imagem em tela cheia');
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '18px';
    closeBtn.style.right = '24px';
    closeBtn.style.fontSize = '2.2rem';
    closeBtn.style.background = 'rgba(0,0,0,0.5)';
    closeBtn.style.color = '#fff';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '8px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.zIndex = '10001';
    closeBtn.style.padding = '2px 16px 6px 16px';
    closeBtn.style.display = 'none';
    closeBtn.style.transition = 'opacity 0.2s';

    function showCloseBtn() {
      closeBtn.style.display = 'block';
      closeBtn.style.opacity = '1';
      setTimeout(() => {
        if (closeBtn.style.display === 'block') {
          closeBtn.style.opacity = '0.7';
        }
      }, 1200);
    }

    function hideCloseBtn() {
      closeBtn.style.opacity = '0';
      setTimeout(() => { closeBtn.style.display = 'none'; }, 200);
    }

    overlay.appendChild(closeBtn);

    // Close overlay
    function closeOverlay() {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      Utils.revokeObjectURL(img.src);
      document.removeEventListener('keydown', escListener);
    }

    closeBtn.onclick = closeOverlay;

    // Toggle close button visibility
    function toggleCloseBtn() {
      if (closeBtn.style.opacity === '0' || closeBtn.style.display === 'none') {
        showCloseBtn();
      } else {
        hideCloseBtn();
      }
    }

    img.addEventListener('click', toggleCloseBtn);
    img.addEventListener('touchend', toggleCloseBtn);

    // ESC key to close
    function escListener(e) {
      if (e.key === 'Escape') closeOverlay();
    }
    document.addEventListener('keydown', escListener);

    // Close when clicking outside
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOverlay();
    });

    // Zoom with mouse wheel
    overlay.addEventListener('wheel', function(e) {
      e.preventDefault();
      let delta = e.deltaY > 0 ? -0.15 : 0.15;
      scale = Math.min(6, Math.max(1, scale + delta));
      img.style.transform = `scale(${scale}) translate(${posX / scale}px,${posY / scale}px)`;
      img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
    }, { passive: false });

    // Pan with mouse
    img.addEventListener('mousedown', function(e) {
      if (scale === 1) return;
      dragging = true;
      startX = e.clientX - posX;
      startY = e.clientY - posY;
      img.style.cursor = 'grabbing';
      e.preventDefault();
    });

    window.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      posX = e.clientX - startX;
      posY = e.clientY - startY;
      img.style.transform = `scale(${scale}) translate(${posX / scale}px,${posY / scale}px)`;
    });

    window.addEventListener('mouseup', function() {
      if (dragging) {
        dragging = false;
        img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
      }
    });

    // Touch events for mobile
    img.addEventListener('touchstart', function(e) {
      if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      } else if (e.touches.length === 1 && scale > 1) {
        dragging = true;
        startX = e.touches[0].clientX - posX;
        startY = e.touches[0].clientY - posY;
      }
    }, { passive: false });

    img.addEventListener('touchmove', function(e) {
      if (e.touches.length === 2 && lastTouchDist !== null) {
        const newDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        let delta = (newDist - lastTouchDist) * 0.012;
        scale = Math.min(6, Math.max(1, scale + delta));
        lastTouchDist = newDist;
        img.style.transform = `scale(${scale}) translate(${posX / scale}px,${posY / scale}px)`;
        img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
        e.preventDefault();
      } else if (e.touches.length === 1 && dragging) {
        posX = e.touches[0].clientX - startX;
        posY = e.touches[0].clientY - startY;
        img.style.transform = `scale(${scale}) translate(${posX / scale}px,${posY / scale}px)`;
        e.preventDefault();
      }
    }, { passive: false });

    img.addEventListener('touchend', function() {
      dragging = false;
      lastTouchDist = null;
      img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
    });

    document.body.appendChild(overlay);

    // Enter fullscreen
    if (overlay.requestFullscreen) {
      overlay.requestFullscreen();
    } else if (overlay.webkitRequestFullscreen) {
      overlay.webkitRequestFullscreen();
    }

    img.focus();
  }
};

// ====== Tab Manager ======
const TabManager = {
  switchTab: async (tabName) => {
    if (currentTab === tabName) return;
    currentTab = tabName;
    UI.updateTabsUI();
    await UI.renderImages();
    StateManager.saveState();
  },
  keyNav: (e, tab, idx) => {
    const allTabs = [...tabs, ...userTabs, "+"];
    if (e.key === 'ArrowRight') {
      let nextIdx = (idx + 1) % allTabs.length;
      if (allTabs[nextIdx] === "+") nextIdx = (nextIdx + 1) % allTabs.length;
      TabManager.switchTab(allTabs[nextIdx]);
      DOM.tabsContainer.children[nextIdx].focus();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      let prevIdx = (idx - 1 + allTabs.length) % allTabs.length;
      if (allTabs[prevIdx] === "+") prevIdx = (prevIdx - 1 + allTabs.length) % allTabs.length;
      TabManager.switchTab(allTabs[prevIdx]);
      DOM.tabsContainer.children[prevIdx].focus();
      e.preventDefault();
    } else if (e.key === 'Home') {
      TabManager.switchTab(allTabs[0]);
      DOM.tabsContainer.children[0].focus();
      e.preventDefault();
    } else if (e.key === 'End') {
      let lastIdx = allTabs.length - 2; // Skip the "+" tab
      TabManager.switchTab(allTabs[lastIdx]);
      DOM.tabsContainer.children[lastIdx].focus();
      e.preventDefault();
    }
  }
};

// ====== State Manager ======
const StateManager = {
  saveState: Utils.debounce(async () => {
    const state = {
      images: Object.fromEntries(Array.from(imageGalleryByTab.entries()).map(([tab, names]) => [tab, Array.from(names)])),
      selected: Object.fromEntries(Array.from(selectedImagesByTab.entries()).map(([tab, set]) => [tab, Array.from(set)])),
      currentTab,
      userTabs
    };
    try {
      await IndexedDBManager.saveMetadata(state);
    } catch (e) {
      console.error('Erro ao salvar estado:', e);
      Utils.showStatus('Erro ao salvar dados.');
    }
  }, 500),

  loadState: async () => {
    try {
      const state = await IndexedDBManager.loadMetadata();
      if (state) {
        imageGalleryByTab = new Map(Object.entries(state.images || {}));
        selectedImagesByTab = new Map();
        for (const tab of [...tabs, ...(state.userTabs || [])]) {
          selectedImagesByTab.set(tab, new Set(state.selected?.[tab] || []));
        }
        currentTab = state.currentTab || tabs[0];
        userTabs = state.userTabs || [];
      } else {
        StateManager.initEmptyState();
      }
    } catch (e) {
      console.error('Erro ao carregar estado:', e);
      StateManager.initEmptyState();
    }
  },

  initEmptyState: () => {
    imageGalleryByTab = new Map();
    selectedImagesByTab = new Map();
    tabs.forEach(tab => {
      imageGalleryByTab.set(tab, []);
      selectedImagesByTab.set(tab, new Set());
    });
    userTabs = [];
  }
};

// ====== Image Processor ======
const ImageProcessor = {
  processImageFile: file => new Promise((resolve, reject) => {
    const img = new Image();
    const url = Utils.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 800;
      let width = img.width, height = img.height;

      if (width > height && width > MAX_SIZE) {
        height *= MAX_SIZE / width;
        width = MAX_SIZE;
      } else if (height > MAX_SIZE) {
        width *= MAX_SIZE / height;
        height = MAX_SIZE;
      }

      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      canvas.toBlob(blob => {
        Utils.revokeObjectURL(url);
        if (blob) resolve({ name: file.name, blob });
        else reject('Falha ao criar Blob');
      }, 'image/webp', 0.80);
    };

    img.onerror = () => {
      Utils.revokeObjectURL(url);
      reject('Erro ao carregar imagem');
    };

    img.src = url;
  })
};

// ====== Image Manager ======
const ImageManager = {
  enterSelectionMode: () => {
    isSelectionMode = true;
    DOM.body.classList.add('selection-mode');
  },
  exitSelectionMode: () => {
    isSelectionMode = false;
    DOM.body.classList.remove('selection-mode');
  },
  toggleSelectImage: (imageName, container) => {
    const selectedSet = selectedImagesByTab.get(currentTab);
    if (selectedSet.has(imageName)) {
      selectedSet.delete(imageName);
      container.classList.remove('selected');
      container.setAttribute('aria-checked', 'false');
      container.querySelector('.image-checkbox').classList.remove('checked');
    } else {
      selectedSet.add(imageName);
      container.classList.add('selected');
      container.setAttribute('aria-checked', 'true');
      container.querySelector('.image-checkbox').classList.add('checked');
    }
    UI.updateSelectionUI();
    StateManager.saveState();
  },
  deleteSelected: async () => {
    const selectedNames = Array.from(selectedImagesByTab.get(currentTab));
    if (!selectedNames.length || !confirm(`Excluir ${selectedNames.length} imagem(ns) selecionada(s)?`)) return;
    
    UI.showLoading();
    try {
      // Delete from local storage
      for (const name of selectedNames) {
        await IndexedDBManager.deleteImageBlob(name);
      }
      
      // Update UI
      const images = imageGalleryByTab.get(currentTab).filter(name => !selectedImagesByTab.get(currentTab).has(name));
      imageGalleryByTab.set(currentTab, images);
      selectedImagesByTab.get(currentTab).clear();
      
      ImageManager.exitSelectionMode();
      await UI.renderImages();
      StateManager.saveState();
      Utils.showStatus(`${selectedNames.length} imagens excluídas.`);
    } catch (error) {
      console.error('Error deleting images:', error);
      Utils.showStatus('Erro ao excluir imagens.');
    } finally {
      UI.hideLoading();
    }
  },
  clearSelection: () => {
    selectedImagesByTab.get(currentTab).clear();
    ImageManager.exitSelectionMode();
    UI.renderImages();
    StateManager.saveState();
    Utils.showStatus('Seleção limpa.');
  },
  toggleSelectAll: () => {
    const allNames = imageGalleryByTab.get(currentTab) || [];
    const selectedSet = selectedImagesByTab.get(currentTab);
    
    if (selectedSet.size === allNames.length) {
      selectedSet.clear();
    } else {
      allNames.forEach(name => selectedSet.add(name));
    }
    
    UI.renderImages();
    StateManager.saveState();
  },
  handleFileSelection: async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    UI.showLoading();
    let loadedCount = 0;
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        
        try {
          const processed = await ImageProcessor.processImageFile(file);
          await IndexedDBManager.addImageBlob(processed.name, processed.blob);
          
          if (!imageGalleryByTab.get(currentTab).includes(processed.name)) {
            imageGalleryByTab.get(currentTab).push(processed.name);
          }
          
          loadedCount++;
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
          Utils.showStatus(`Erro ao carregar ${file.name}`);
        }
      }
      
      await UI.renderImages();
      StateManager.saveState();
      Utils.showStatus(`${loadedCount} imagem(ns) carregada(s) com sucesso!`);
    } catch (error) {
      console.error('Error handling file selection:', error);
      Utils.showStatus('Erro ao carregar imagens.');
    } finally {
      UI.hideLoading();
    }
  },
  reorderImages: async (fromIndex, toIndex) => {
    const images = imageGalleryByTab.get(currentTab) || [];
    if (fromIndex < 0 || fromIndex >= images.length || toIndex < 0 || toIndex >= images.length) return;
    
    const [moved] = images.splice(fromIndex, 1);
    images.splice(toIndex, 0, moved);
    imageGalleryByTab.set(currentTab, images);
    selectedImagesByTab.get(currentTab).clear();
    
    await UI.renderImages();
    StateManager.saveState();
  }
};

// ====== Event Manager ======
const EventManager = {
  setup: () => {
    // Selection buttons
    DOM.clearSelectionBtn.onclick = ImageManager.clearSelection;
    DOM.deleteSelectedBtn.onclick = ImageManager.deleteSelected;
    DOM.selectAllBtn.onclick = ImageManager.toggleSelectAll;

    // File input
    DOM.openFileDialogButton.onclick = () => {
      DOM.fileInput.value = '';
      DOM.fileInput.click();
    };
    DOM.fileInput.onchange = ImageManager.handleFileSelection;

    // Dark mode toggle
    DOM.darkModeToggle.onclick = () => {
      const isDark = document.documentElement.classList.contains('dark');
      setDarkMode(!isDark);
    };

    // Drag and drop for reordering
    if (DOM.imageList) {
      DOM.imageList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(DOM.imageList, e.clientY);
        const dragging = document.querySelector('.dragging');
        if (!dragging) return;
        
        DOM.imageList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (afterElement) afterElement.classList.add('drag-over');
      });

      DOM.imageList.addEventListener('drop', (e) => {
        e.preventDefault();
        const dragging = document.querySelector('.dragging');
        if (!dragging) return;
        
        const afterElement = getDragAfterElement(DOM.imageList, e.clientY);
        const containers = Array.from(DOM.imageList.children);
        const fromIndex = containers.indexOf(dragging);
        let toIndex = afterElement ? containers.indexOf(afterElement) : containers.length - 1;
        
        if (fromIndex < toIndex) toIndex--;
        if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
          ImageManager.reorderImages(fromIndex, toIndex);
        }
        
        dragging.classList.remove('dragging');
        DOM.imageList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
    }

    function getDragAfterElement(container, y) {
      const draggableElements = [...container.querySelectorAll('.image-container:not(.dragging)')];
      return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      }, { offset: -Infinity, element: null }).element;
    }
  }
};

// ====== Dark Mode ======
function setDarkMode(on) {
  if (on) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('darkMode', 'on');
    DOM.darkModeToggle.querySelector('i').className = 'fas fa-sun';
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('darkMode', 'off');
    DOM.darkModeToggle.querySelector('i').className = 'fas fa-moon';
  }
}

function detectDarkMode() {
  const saved = localStorage.getItem('darkMode');
  if (saved === 'on') return true;
  if (saved === 'off') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ====== Initialization ======
async function init() {
  // Set initial modes
  setDarkMode(detectDarkMode());

  // Load app state
  UI.showLoading();
  try {
    await IndexedDBManager.open();
    await StateManager.loadState();
    UI.createTabs();
    UI.updateTabsUI();
    await UI.renderImages();
    EventManager.setup();
  } catch (e) {
    console.error('Initialization error:', e);
    Utils.showStatus("Erro ao iniciar o aplicativo. Tente recarregar a página.");
  } finally {
    UI.hideLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
