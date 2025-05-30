// Cache de elementos DOM
const DOM = {
  tabsContainer: document.getElementById('tabs-container'),
  imageList: document.getElementById('image-list'),
  fileInput: document.getElementById('file-input'),
  openFileDialogButton: document.getElementById('open-file-dialog'),
  openCloudFolderButton: document.getElementById('open-cloud-folder'),
  deleteSelectedBtn: document.getElementById('delete-selected-btn'),
  clearSelectionBtn: document.getElementById('clear-selection-btn'),
  selectAllBtn: document.getElementById('select-all-btn'),
  floatControls: document.getElementById('float-controls'),
  syncBtn: document.getElementById('sync-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  loadingSpinner: document.getElementById('loading-spinner'),
  statusMessage: document.getElementById('status-message'),
  body: document.body,
};

const tabs = [
  "Domingo Manhã", "Domingo Noite", "Segunda", "Quarta", "Culto Jovem", "Santa Ceia", "Outros"
];
const ONE_DRIVE_FOLDER_URL = "https://1drv.ms/f/c/a71268bf66931c02/EpYyUsypAQhGgpWC9YuvE54BD_o9NX9tRar0piSzq4V4Xg";

// Estado
let imageGalleryByTab = new Map();
let selectedImagesByTab = new Map();
let currentTab = tabs[0];
let isSelectionMode = false;
let dragStartIndex = null;

tabs.forEach(tab => {
  imageGalleryByTab.set(tab, []);
  selectedImagesByTab.set(tab, new Set());
});

const Utils = {
  removeFileExtension: filename => filename.replace(/\.[^/.]+$/, ""),
  showStatus: message => {
    DOM.statusMessage.textContent = message;
    DOM.statusMessage.classList.add('show');
    setTimeout(() => DOM.statusMessage.classList.remove('show'), 3000);
  },
  debounce: (func, timeout = 100) => {
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

// IndexedDB
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
      console.error('IndexedDB error:', event.target.errorCode);
      reject(event.target.errorCode);
    };
  }),

  addImageBlob: (imageName, blob) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_IMAGES], 'readwrite');
      const store = transaction.objectStore(STORE_IMAGES);
      const request = store.put({ name: imageName, blob: blob });
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
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
      request.onsuccess = () => resolve();
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
      request.onsuccess = () => resolve();
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

const ImageProcessor = {
  processImageFile: file => new Promise((resolve, reject) => {
    const img = new Image();
    const url = Utils.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 800;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(blob => {
        Utils.revokeObjectURL(url);
        if (blob) {
          resolve({ name: file.name, blob: blob });
        } else {
          reject(new Error('Falha ao criar Blob da imagem.'));
        }
      }, 'image/webp', 0.75);
    };

    img.onerror = () => {
      Utils.revokeObjectURL(url);
      reject(new Error('Erro ao carregar a imagem para processamento.'));
    };

    img.src = url;
  })
};

const StateManager = {
  saveState: Utils.debounce(async () => {
    const state = {
      images: Object.fromEntries(Array.from(imageGalleryByTab.entries()).map(([tab, names]) => [tab, Array.from(names)])),
      selected: Object.fromEntries(Array.from(selectedImagesByTab.entries()).map(([tab, set]) => [tab, Array.from(set)])),
      currentTab,
    };
    try {
      await IndexedDBManager.saveMetadata(state);
    } catch (e) {
      console.error('Erro ao salvar estado no IndexedDB:', e);
      Utils.showStatus('Erro ao salvar dados.');
    }
  }, 500),

  loadState: async () => {
    try {
      const state = await IndexedDBManager.loadMetadata();
      if (state) {
        imageGalleryByTab = new Map(Object.entries(state.images || {}));
        selectedImagesByTab = new Map();
        for (const tab of tabs) {
          selectedImagesByTab.set(tab, new Set(state.selected?.[tab] || []));
        }
        currentTab = state.currentTab || tabs[0];
      } else {
        StateManager.initEmptyState();
      }
    } catch (e) {
      console.error('Erro ao carregar estado do IndexedDB:', e);
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
  }
};

const UI = {
  showLoading: () => DOM.loadingSpinner.classList.add('active'),
  hideLoading: () => DOM.loadingSpinner.classList.remove('active'),

  createTabs: () => {
    DOM.tabsContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    tabs.forEach((tab, index) => {
      const tabBtn = document.createElement('button');
      tabBtn.className = 'tab';
      tabBtn.setAttribute('role', 'tab');
      tabBtn.setAttribute('tabindex', index === 0 ? '0' : '-1');
      tabBtn.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      tabBtn.id = `tab-${tab.replace(/\s+/g, '-').toLowerCase()}`;
      tabBtn.textContent = tab;

      tabBtn.addEventListener('click', () => TabManager.switchTab(tab));
      tabBtn.addEventListener('keydown', (e) => {
        const currentActiveIndex = tabs.indexOf(currentTab);
        let nextIndex = currentActiveIndex;

        if (e.key === 'ArrowRight') nextIndex = (currentActiveIndex + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') nextIndex = (currentActiveIndex - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') nextIndex = 0;
        else if (e.key === 'End') nextIndex = tabs.length - 1;

        if (nextIndex !== currentActiveIndex) {
          e.preventDefault();
          TabManager.switchTab(tabs[nextIndex]);
          DOM.tabsContainer.querySelector(`#tab-${tabs[nextIndex].replace(/\s+/g, '-').toLowerCase()}`).focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          TabManager.switchTab(tab);
        }
      });

      fragment.appendChild(tabBtn);
    });

    DOM.tabsContainer.appendChild(fragment);
  },

  updateTabsUI: () => {
    const buttons = DOM.tabsContainer.querySelectorAll('.tab');
    buttons.forEach(btn => {
      const isActive = btn.textContent === currentTab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive);
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
  },

  renderImages: async () => {
    DOM.imageList.querySelectorAll('img[data-object-url]').forEach(img => {
      Utils.revokeObjectURL(img.dataset.objectUrl);
    });

    const imageNames = imageGalleryByTab.get(currentTab) || [];
    const fragment = document.createDocumentFragment();

    if (imageNames.length === 0) {
      const p = document.createElement('p');
      p.className = 'text-center text-gray-500 py-8';
      p.textContent = 'Nenhuma imagem encontrada nesta categoria.';
      fragment.appendChild(p);
    } else {
      const imagesToRender = [];
      for (const imageName of imageNames) {
        const blob = await IndexedDBManager.getImageBlob(imageName);
        if (blob) {
          imagesToRender.push({ name: imageName, blob: blob });
        } else {
          imageGalleryByTab.set(currentTab, imageNames.filter(name => name !== imageName));
          selectedImagesByTab.get(currentTab).delete(imageName);
        }
      }
      imagesToRender.forEach(({ name, blob }) => {
        const container = UI.createImageElement(name, blob);
        fragment.appendChild(container);
      });
    }
    DOM.imageList.innerHTML = '';
    DOM.imageList.appendChild(fragment);
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
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      ImageManager.toggleSelectImage(imageName, container);
    });

    const img = document.createElement('img');
    const objectURL = Utils.createObjectURL(imageBlob);
    img.src = objectURL;
    img.dataset.objectUrl = objectURL;
    img.alt = Utils.removeFileExtension(imageName);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'image-name';
    nameSpan.textContent = Utils.removeFileExtension(imageName);

    container.appendChild(checkbox);
    container.appendChild(img);
    container.appendChild(nameSpan);

    // Duplo clique/Double tap para abrir fullscreen
    container.addEventListener('dblclick', () => {
      if (!isSelectionMode) {
        const objectURL = Utils.createObjectURL(imageBlob);
        UI.openFullscreen(objectURL, Utils.removeFileExtension(imageName));
      }
    });

    let lastTapTime = 0;
    let tapTimeout = null;
    container.addEventListener('touchend', (e) => {
      if (e.touches && e.touches.length > 1) return; // ignore multi-touch
      const currentTime = new Date().getTime();
      if (currentTime - lastTapTime < 400) {
        clearTimeout(tapTimeout);
        if (!isSelectionMode) {
          const objectURL = Utils.createObjectURL(imageBlob);
          UI.openFullscreen(objectURL, Utils.removeFileExtension(imageName));
        }
      }
      lastTapTime = currentTime;
      tapTimeout = setTimeout(() => { lastTapTime = 0; }, 450);
    });

    // Seleção e drag and drop
    let pressTimer;
    let isLongPress = false;
    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        if (!isSelectionMode) {
          ImageManager.enterSelectionMode();
        }
        ImageManager.toggleSelectImage(imageName, container);
      }, 500);
    });
    container.addEventListener('mousemove', () => { clearTimeout(pressTimer); });
    container.addEventListener('mouseup', () => { clearTimeout(pressTimer); isLongPress = false; });
    container.addEventListener('mouseleave', () => { clearTimeout(pressTimer); isLongPress = false; });

    container.addEventListener('dragstart', (e) => {
      if (!isSelectionMode) {
        ImageManager.enterSelectionMode();
        ImageManager.toggleSelectImage(imageName, container);
      }
      container.classList.add('dragging');
      dragStartIndex = Array.from(DOM.imageList.children).indexOf(container);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', imageName);
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
    if (totalImages <= 1) {
      DOM.selectAllBtn.style.display = 'none';
    } else {
      DOM.selectAllBtn.style.display = 'flex';
    }
  },

  openFullscreen: (src, alt) => {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-image';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Visualização da imagem ${alt}`);

    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.tabIndex = 0;

    // Centro da imagem para zoom
    let scale = 1;
    let translateX = 0, translateY = 0;
    let originX = 0.5, originY = 0.5;
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let imgStart = { x: 0, y: 0 };
    let initialPinchDistance = null;
    let lastScale = 1;

    function updateTransform() {
      img.style.transformOrigin = `${originX * 100}% ${originY * 100}%`;
      img.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
    }

    // Desktop: ZOOM centralizado no mouse e arrastar imagem
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

      // Corrige a posição para manter o ponto sob o cursor
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
      document.body.style.cursor = 'grabbing';
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      translateX = imgStart.x + (e.clientX - dragStart.x);
      translateY = imgStart.y + (e.clientY - dragStart.y);
      updateTransform();
    });
    overlay.addEventListener('mouseup', () => {
      isDragging = false;
      document.body.style.cursor = '';
    });
    overlay.addEventListener('mouseleave', () => {
      isDragging = false;
      document.body.style.cursor = '';
    });

    // Mobile: pinch/drag, impede fechar ao pinçar
    let lastTapTime = 0;
    let tapTimeout = null;
    img.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        initialPinchDistance = Math.hypot(
          e.touches[1].pageX - e.touches[0].pageX,
          e.touches[1].pageY - e.touches[0].pageY
        );
        lastScale = scale;
        // calcula centro inicial do pinch
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
        // pinch zoom
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
        // arrastar
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

    // Fechar fullscreen: duplo clique ou double tap no overlay (não na imagem!)
    overlay.addEventListener('dblclick', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        Utils.revokeObjectURL(img.src);
      }
    });
    overlay.addEventListener('touchend', (e) => {
      if (e.target !== overlay) return;
      const currentTime = new Date().getTime();
      if (currentTime - lastTapTime < 400) {
        clearTimeout(tapTimeout);
        document.body.removeChild(overlay);
        Utils.revokeObjectURL(img.src);
      }
      lastTapTime = currentTime;
      tapTimeout = setTimeout(() => { lastTapTime = 0; }, 450);
    });

    overlay.appendChild(img);
    document.body.appendChild(overlay);
    img.focus();
  }
};

const TabManager = {
  switchTab: async tabName => {
    if (currentTab === tabName) return;
    currentTab = tabName;
    UI.updateTabsUI();
    await UI.renderImages();
    StateManager.saveState();
  }
};

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
  deleteImage: async imageName => {
    if (!confirm(`Tem certeza que deseja excluir "${Utils.removeFileExtension(imageName)}"?`)) return;
    UI.showLoading();
    try {
      await IndexedDBManager.deleteImageBlob(imageName);
      const images = imageGalleryByTab.get(currentTab).filter(name => name !== imageName);
      imageGalleryByTab.set(currentTab, images);
      selectedImagesByTab.get(currentTab).delete(imageName);
      await UI.renderImages();
      StateManager.saveState();
      Utils.showStatus('Imagem excluída com sucesso!');
    } catch (error) {
      Utils.showStatus('Erro ao excluir imagem.');
    } finally {
      UI.hideLoading();
    }
  },
  reorderImages: async (fromIndex, toIndex) => {
    const images = imageGalleryByTab.get(currentTab) || [];
    const movedImageName = images.splice(fromIndex, 1)[0];
    images.splice(toIndex, 0, movedImageName);
    imageGalleryByTab.set(currentTab, images);
    selectedImagesByTab.get(currentTab).clear();
    ImageManager.exitSelectionMode();
    await UI.renderImages();
    StateManager.saveState();
  },
  deleteSelected: async () => {
    const selectedNames = Array.from(selectedImagesByTab.get(currentTab));
    const count = selectedNames.length;
    if (!count || !confirm(`Excluir ${count} imagem(ns) selecionada(s)?`)) return;
    UI.showLoading();
    try {
      for (const name of selectedNames) await IndexedDBManager.deleteImageBlob(name);
      const images = imageGalleryByTab.get(currentTab).filter(name => !selectedImagesByTab.get(currentTab).has(name));
      imageGalleryByTab.set(currentTab, images);
      selectedImagesByTab.get(currentTab).clear();
      ImageManager.exitSelectionMode();
      await UI.renderImages();
      StateManager.saveState();
      Utils.showStatus(`${count} imagens excluídas.`);
    } catch (error) {
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
    if (selectedSet.size === allNames.length) selectedSet.clear();
    else allNames.forEach(name => selectedSet.add(name));
    UI.renderImages();
    StateManager.saveState();
  },
  handleFileSelection: async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    UI.showLoading();
    if (!imageGalleryByTab.get(currentTab)) imageGalleryByTab.set(currentTab, []);
    if (!selectedImagesByTab.get(currentTab)) selectedImagesByTab.set(currentTab, new Set());
    const currentImageNamesInTab = new Set(imageGalleryByTab.get(currentTab));
    let loadedCount = 0;
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        try {
          const processed = await ImageProcessor.processImageFile(file);
          if (!processed) continue;
          await IndexedDBManager.addImageBlob(processed.name, processed.blob);
          if (!currentImageNamesInTab.has(processed.name)) {
            imageGalleryByTab.get(currentTab).push(processed.name);
            currentImageNamesInTab.add(processed.name);
          }
          loadedCount++;
        } catch (error) {
          Utils.showStatus(`Erro ao carregar ${file.name}`);
        }
      }
      await UI.renderImages();
      StateManager.saveState();
      Utils.showStatus(`${loadedCount} imagem(ns) carregada(s) com sucesso!`);
    } catch (error) {
      Utils.showStatus('Erro ao carregar imagens.');
    } finally {
      UI.hideLoading();
    }
  }
};

const EventManager = {
  setup: () => {
    DOM.imageList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const afterElement = getDragAfterElement(DOM.imageList, e.clientY);
      const draggable = document.querySelector('.dragging');
      if (!draggable) return;
      DOM.imageList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      if (afterElement) afterElement.classList.add('drag-over');
    });
    DOM.imageList.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggable = document.querySelector('.dragging');
      if (!draggable) return;
      const afterElement = getDragAfterElement(DOM.imageList, e.clientY);
      const containers = Array.from(DOM.imageList.children);
      const fromIndex = containers.indexOf(draggable);
      let toIndex = afterElement ? containers.indexOf(afterElement) : containers.length - 1;
      if (fromIndex < toIndex) toIndex--;
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) ImageManager.reorderImages(fromIndex, toIndex);
      draggable.classList.remove('dragging');
      DOM.imageList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    function getDragAfterElement(container, y) {
      const draggableElements = [...container.querySelectorAll('.image-container:not(.dragging)')];
      return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
      }, { offset: -Infinity, element: null }).element;
    }
    DOM.clearSelectionBtn.addEventListener('click', ImageManager.clearSelection);
    DOM.deleteSelectedBtn.addEventListener('click', ImageManager.deleteSelected);
    DOM.selectAllBtn.addEventListener('click', ImageManager.toggleSelectAll);

    DOM.openFileDialogButton.addEventListener('click', () => {
      DOM.fileInput.value = '';
      DOM.fileInput.click();
    });
    DOM.fileInput.addEventListener('change', ImageManager.handleFileSelection);

    DOM.openCloudFolderButton.addEventListener('click', () => {
      window.open(ONE_DRIVE_FOLDER_URL, '_blank');
      Utils.showStatus('Abrindo pasta do OneDrive em uma nova aba.');
    });
    DOM.syncBtn.addEventListener('click', () => {
      Utils.showStatus('Funcionalidade de Sincronização em desenvolvimento...');
    });
    DOM.settingsBtn.addEventListener('click', () => {
      Utils.showStatus('Funcionalidade de Configurações em desenvolvimento...');
    });
  }
};

async function init() {
  UI.showLoading();
  try {
    await IndexedDBManager.open();
    await StateManager.loadState();
    UI.createTabs();
    UI.updateTabsUI();
    await UI.renderImages();
    EventManager.setup();
  } catch (e) {
    Utils.showStatus("Erro ao iniciar o aplicativo. Tente recarregar a página.");
  } finally {
    UI.hideLoading();
  }
}


async function renderImages() {
  const list = document.getElementById('image-list');
  list.innerHTML = "";
  const names = imageGalleryByTab.get(currentTab) || [];
  if (!names.length) {
    list.innerHTML = `<p class="text-center text-gray-500 py-8">Nenhuma cifra adicionada.</p>`;
  } else {
    for (let name of names) {
      const blob = await IndexedDB.getImage(`${currentTab}:${name}`);
      if (!blob) continue;
      const container = createImageElement(name, blob);
      list.appendChild(container);
    }
  }
  updateSelectionControls();
}


document.addEventListener('DOMContentLoaded', init);
