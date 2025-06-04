// ======== Utilitários Avançados ========
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
  },
  formatBytes: (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
};

// ======== IndexedDB Configuração ========
const DB_NAME = 'CifrasDBv4';
const DB_VERSION = 3;
const STORE_IMAGES = 'images';
const STORE_METADATA = 'metadata';
const STORE_ONLINE = 'onlineCache';

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
      if (!db.objectStoreNames.contains(STORE_ONLINE)) {
        const store = db.createObjectStore(STORE_ONLINE, { keyPath: 'id' });
        store.createIndex('tab', 'tab', { unique: false });
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

  // Métodos para armazenamento offline
  addImageBlob: (imageName, blob) => IndexedDBManager._performTransaction(STORE_IMAGES, 'readwrite', store => 
    store.put({ name: imageName, blob, lastModified: Date.now() })
  ),

  getImageBlob: (imageName) => IndexedDBManager._performTransaction(STORE_IMAGES, 'readonly', store => 
    store.get(imageName)
  ),

  deleteImageBlob: (imageName) => IndexedDBManager._performTransaction(STORE_IMAGES, 'readwrite', store => 
    store.delete(imageName)
  ),

  // Métodos para metadados
  saveMetadata: (state, isOnline = false) => IndexedDBManager._performTransaction(
    STORE_METADATA, 
    'readwrite', 
    store => store.put({ 
      id: isOnline ? 'onlineState' : 'offlineState', 
      state,
      timestamp: Date.now()
    })
  ),

  loadMetadata: (isOnline = false) => IndexedDBManager._performTransaction(
    STORE_METADATA, 
    'readonly', 
    store => store.get(isOnline ? 'onlineState' : 'offlineState')
  ),

  // Métodos para cache online
  cacheOnlineImage: (tab, file) => IndexedDBManager._performTransaction(
    STORE_ONLINE, 
    'readwrite', 
    store => store.put({
      id: file.id,
      tab,
      name: file.name,
      webContentLink: file.webContentLink,
      thumbnailLink: file.thumbnailLink || file.webContentLink,
      lastCached: Date.now()
    })
  ),

  getCachedOnlineImages: (tab) => IndexedDBManager._performTransaction(
    STORE_ONLINE,
    'readonly',
    store => {
      const index = store.index('tab');
      return index.getAll(tab);
    }
  ),

  clearOldCache: (maxAge = 30 * 24 * 60 * 60 * 1000) => IndexedDBManager._performTransaction(
    STORE_ONLINE,
    'readwrite',
    store => {
      const threshold = Date.now() - maxAge;
      const index = store.index('tab');
      const request = index.openCursor();
      request.onsuccess = function(event) {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.lastCached < threshold) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      request.onerror = function(event) {
        console.error("Erro ao abrir cursor:", event.target.error);
      };
    }
  ),

  // Método auxiliar para transações
  _performTransaction: (storeName, mode, operation) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([storeName], mode);
      const store = transaction.objectStore(storeName);
      const request = operation(store);
      if (request && request.onsuccess) {
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
      } else {
        transaction.oncomplete = () => resolve(request);
        transaction.onerror = (e) => reject(e.target.error);
      }
    } catch (e) {
      reject(e);
    }
  })
};

// ======== Google Drive API ========
const DriveManager = {
  API_KEY: window.GDRIVE_API_KEY,
  FOLDER_ID: window.GDRIVE_FOLDER_ID,
  searchFiles: async (query = '', pageSize = 1000) => {
    if (!DriveManager.API_KEY || !DriveManager.FOLDER_ID) {
      throw new Error("Configuração da API do Google Drive ausente");
    }
    let files = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `'${DriveManager.FOLDER_ID}' in parents and trashed = false ${query}`,
        fields: 'nextPageToken,files(id,name,mimeType,webContentLink,thumbnailLink,webViewLink,size,modifiedTime)',
        key: DriveManager.API_KEY,
        pageSize,
        pageToken,
        orderBy: 'name'
      });
      const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
      if (!response.ok) {
        throw new Error(`Erro na API: ${response.status}`);
      }
      const data = await response.json();
      files.push(...data.files.filter(f => f.mimeType.startsWith('image/')));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return files;
  },
  getImageUrl: (fileId) => `https://drive.google.com/uc?id=${fileId}&export=download&key=${DriveManager.API_KEY}`,
  getThumbnailUrl: (fileId) => `https://drive.google.com/thumbnail?id=${fileId}&sz=w300&key=${DriveManager.API_KEY}`
};

// ======== Estado do Aplicativo ========
const AppState = {
  defaultTabs: [
    "Domingo Manhã", "Domingo Noite", "Segunda", 
    "Quarta", "Culto Jovem", "Santa Ceia"
  ],
  current: {
    tabs: [],
    userTabs: [],
    imageGallery: new Map(),
    selectedImages: new Map(),
    currentTab: null,
    isOnline: false,
    isSelectionMode: false,
    searchQuery: ''
  },
  init: async function(isOnline = false) {
    this.current.isOnline = isOnline;
    await this.loadState(isOnline);
    this.defaultTabs.forEach(tab => {
      if (!this.current.imageGallery.has(tab)) {
        this.current.imageGallery.set(tab, []);
        this.current.selectedImages.set(tab, new Set());
      }
    });
    this.current.tabs = [...this.defaultTabs, ...(this.current.userTabs || [])];
    if (!this.current.currentTab || !this.current.imageGallery.has(this.current.currentTab)) {
      this.current.currentTab = this.defaultTabs[0];
    }
  },
  loadState: async function(isOnline) {
    try {
      const state = await IndexedDBManager.loadMetadata(isOnline);
      if (state && state.state) {
        this.current.tabs = [...this.defaultTabs, ...(state.state.userTabs || [])];
        this.current.userTabs = state.state.userTabs || [];
        this.current.currentTab = state.state.currentTab || this.defaultTabs[0];
        this.current.imageGallery = new Map();
        this.current.selectedImages = new Map();
        for (const [tab, images] of Object.entries(state.state.images || {})) {
          this.current.imageGallery.set(tab, Array.isArray(images) ? images : []);
        }
        for (const [tab, selected] of Object.entries(state.state.selected || {})) {
          this.current.selectedImages.set(tab, new Set(Array.isArray(selected) ? selected : []));
        }
      } else {
        this.resetState();
      }
    } catch (error) {
      console.error('Erro ao carregar estado:', error);
      this.resetState();
    }
  },
  saveState: Utils.debounce(async () => {
    AppState.current.tabs = [...AppState.defaultTabs, ...(AppState.current.userTabs || [])];
    const state = {
      images: Object.fromEntries(AppState.current.imageGallery),
      selected: Object.fromEntries(
        Array.from(AppState.current.selectedImages.entries())
          .map(([tab, set]) => [tab, Array.from(set)])
      ),
      currentTab: AppState.current.currentTab,
      userTabs: AppState.current.userTabs
    };
    try {
      await IndexedDBManager.saveMetadata(state, AppState.current.isOnline);
    } catch (error) {
      console.error('Erro ao salvar estado:', error);
      Utils.showStatus('Erro ao salvar configurações');
    }
  }, 500),
  resetState: function() {
    this.current.tabs = [...this.defaultTabs];
    this.current.userTabs = [];
    this.current.currentTab = this.defaultTabs[0];
    this.current.imageGallery = new Map();
    this.current.selectedImages = new Map();
    this.defaultTabs.forEach(tab => {
      this.current.imageGallery.set(tab, []);
      this.current.selectedImages.set(tab, new Set());
    });
  },
  addTab: function(name) {
    name = name.trim();
    if (!name || this.current.tabs.includes(name) || name === '+') return false;
    this.current.userTabs.push(name);
    this.current.tabs.push(name);
    this.current.imageGallery.set(name, []);
    this.current.selectedImages.set(name, new Set());
    this.current.currentTab = name;
    this.saveState();
    return true;
  },
  removeTab: function(name) {
    if (!this.current.userTabs.includes(name)) return false;
    this.current.userTabs = this.current.userTabs.filter(t => t !== name);
    this.current.tabs = this.current.tabs.filter(t => t !== name);
    this.current.imageGallery.delete(name);
    this.current.selectedImages.delete(name);
    if (this.current.currentTab === name) {
      this.current.currentTab = this.defaultTabs[0];
    }
    this.saveState();
    return true;
  },
  switchTab: function(tabName) {
    if (this.current.currentTab === tabName || !this.current.imageGallery.has(tabName)) return;
    this.current.currentTab = tabName;
    this.saveState();
  },
  addImages: function(images) {
    console.log('addImages', images, 'currentTab:', this.current.currentTab);
    const currentImages = this.current.imageGallery.get(this.current.currentTab) || [];
    const newImages = images.filter(img => 
      !currentImages.some(existing => 
        this.current.isOnline ? existing.id === img.id : existing.name === img.name
      )
    );
    if (newImages.length > 0) {
      this.current.imageGallery.set(
        this.current.currentTab, 
        [...currentImages, ...newImages]
      );
      console.log('imageGallery', this.current.imageGallery);
      this.saveState();
    }
    return newImages.length;
  },
  removeSelectedImages: function() {
    const tab = this.current.currentTab;
    const selected = this.current.selectedImages.get(tab);
    if (!selected || selected.size === 0) return 0;
    const images = this.current.imageGallery.get(tab).filter(
      img => !selected.has(this.current.isOnline ? img.id : img.name)
    );
    this.current.imageGallery.set(tab, images);
    this.current.selectedImages.get(tab).clear();
    this.current.isSelectionMode = false;
    this.saveState();
    return selected.size;
  },
  toggleImageSelection: function(imageId) {
    const tab = this.current.currentTab;
    const selected = this.current.selectedImages.get(tab);
    if (selected.has(imageId)) {
      selected.delete(imageId);
    } else {
      selected.add(imageId);
    }
    this.current.isSelectionMode = selected.size > 0;
    this.saveState();
  },
  toggleSelectAll: function() {
    const tab = this.current.currentTab;
    const images = this.current.imageGallery.get(tab) || [];
    const selected = this.current.selectedImages.get(tab);
    if (selected.size === images.length) {
      selected.clear();
    } else {
      images.forEach(img => selected.add(this.current.isOnline ? img.id : img.name));
    }
    this.current.isSelectionMode = selected.size > 0;
    this.saveState();
  },
  clearSelection: function() {
    const tab = this.current.currentTab;
    this.current.selectedImages.get(tab).clear();
    this.current.isSelectionMode = false;
    this.saveState();
  },
  searchImages: function(query) {
    this.current.searchQuery = query.toLowerCase().trim();
  },
  getFilteredImages: function() {
    const tab = this.current.currentTab;
    const images = this.current.imageGallery.get(tab) || [];
    if (!this.current.searchQuery) return images;
    return images.filter(img => 
      img.name.toLowerCase().includes(this.current.searchQuery)
    );
  }
};

// ======== UIManager Melhorado ========
const UIManager = {
  elements: {
    tabsContainer: document.getElementById('tabs-container'),
    imageList: document.getElementById('image-list'),
    fileInput: document.getElementById('file-input'),
    openFileDialogBtn: document.getElementById('open-file-dialog'),
    openCloudBtn: document.getElementById('open-cloud-folder'),
    cloudModal: document.getElementById('modal-nuvem'),
    closeCloudModal: document.getElementById('close-modal-nuvem'),
    cloudSearch: document.getElementById('filtro-cifra'),
    cloudFileList: document.getElementById('lista-cifras'),
    addCloudFilesBtn: document.getElementById('incluir-cifras-btn'),
    selectAllBtn: document.getElementById('select-all-btn'),
    clearSelectionBtn: document.getElementById('clear-selection-btn'),
    deleteSelectedBtn: document.getElementById('delete-selected-btn'),
    floatControls: document.getElementById('float-controls'),
    loadingSpinner: document.getElementById('loading-spinner'),
    statusMessage: document.getElementById('status-message'),
    modeSwitch: document.getElementById('online-switch'),
    modeLabel: document.getElementById('online-status-label'),
    searchInput: document.getElementById('search-input')
  },
  init: function() {
    this.renderTabs();
    this.renderImages();
    this.setupEventListeners();
    this.updateUI();
  },
  renderTabs: function() {
    this.elements.tabsContainer.innerHTML = '';
    const allTabs = [...AppState.defaultTabs, ...(AppState.current.userTabs || []), '+'];
    allTabs.forEach((tab, idx) => {
      const isPlus = (tab === '+');
      const isUserTab = AppState.current.userTabs.includes(tab);
      const btn = document.createElement('button');
      btn.className = 'tab px-4 py-2 rounded-t focus:outline-none';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('tabindex', idx === 0 ? '0' : '-1');
      btn.setAttribute('aria-selected', AppState.current.currentTab === tab);
      btn.id = `tab-${tab.replace(/\s+/g, '-').toLowerCase()}`;
      btn.textContent = tab;
      if (isPlus) {
        btn.classList.add('bg-green-500', 'text-white', 'ml-2');
        btn.onclick = () => {
          this.showAddTabDialog();
        };
      } else {
        if (AppState.current.currentTab === tab) {
          btn.classList.add('active', 'bg-blue-500', 'text-white');
        } else {
          btn.classList.add('bg-gray-200', 'text-gray-700');
        }
        btn.onclick = () => {
          AppState.switchTab(tab);
          this.renderTabs();
          this.renderImages();
        };
        btn.onkeydown = (e) => this.handleTabKeyNavigation(e, tab, idx);
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
            this.showRemoveTabDialog(tab);
          };
          btn.appendChild(closeBtn);
          btn.onmouseenter = () => (closeBtn.style.display = "block");
          btn.onmouseleave = () => (closeBtn.style.display = "none");
          btn.onfocus = () => (closeBtn.style.display = "block");
          btn.onblur = () => (closeBtn.style.display = "none");
        }
      }
      this.elements.tabsContainer.appendChild(btn);
    });
  },
  handleTabKeyNavigation: function(e, tab, index) {
    const allTabs = [...AppState.defaultTabs, ...(AppState.current.userTabs || []), '+'];
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        let nextIndex = index;
        do {
          nextIndex = (nextIndex + 1) % allTabs.length;
        } while (allTabs[nextIndex] === '+');
        AppState.switchTab(allTabs[nextIndex]);
        this.renderTabs();
        this.renderImages();
        this.elements.tabsContainer.children[nextIndex].focus();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        let prevIndex = index;
        do {
          prevIndex = (prevIndex - 1 + allTabs.length) % allTabs.length;
        } while (allTabs[prevIndex] === '+');
        AppState.switchTab(allTabs[prevIndex]);
        this.renderTabs();
        this.renderImages();
        this.elements.tabsContainer.children[prevIndex].focus();
        break;
      case 'Home':
        e.preventDefault();
        AppState.switchTab(allTabs[0]);
        this.renderTabs();
        this.renderImages();
        this.elements.tabsContainer.children[0].focus();
        break;
      case 'End':
        e.preventDefault();
        const lastIndex = allTabs.length - 2;
        AppState.switchTab(allTabs[lastIndex]);
        this.renderTabs();
        this.renderImages();
        this.elements.tabsContainer.children[lastIndex].focus();
        break;
    }
  },
  renderImages: async function() {
    this.elements.imageList.innerHTML = '';
    const images = AppState.getFilteredImages();
    console.log('renderImages - imagens para renderizar:', images, 'aba atual:', AppState.current.currentTab, 'filtro:', AppState.current.searchQuery);
    this.elements.imageList.querySelectorAll('img[data-object-url]').forEach(img => {
      Utils.revokeObjectURL(img.dataset.objectUrl);
    });
    if (images.length === 0) {
      const emptyMessage = document.createElement('p');
      emptyMessage.className = 'text-center text-gray-500 py-8';
      emptyMessage.textContent = AppState.current.searchQuery 
        ? 'Nenhuma cifra encontrada.' 
        : 'Nenhuma cifra adicionada.';
      this.elements.imageList.appendChild(emptyMessage);
      return;
    }
    if (AppState.current.isOnline) {
      await this.renderOnlineImages(images);
    } else {
      await this.renderOfflineImages(images);
    }
  },
  renderOnlineImages: async function(images) {
    const selected = AppState.current.selectedImages.get(AppState.current.currentTab);
    for (const image of images) {
      try {
        const cached = await IndexedDBManager.getCachedOnlineImages(AppState.current.currentTab)
          .then(files => files.find(f => f.id === image.id));
        const container = this.createImageElement({
          id: image.id,
          name: image.name,
          url: cached ? cached.thumbnailLink : DriveManager.getThumbnailUrl(image.id),
          isSelected: selected.has(image.id),
          isOnline: true
        });
        this.elements.imageList.appendChild(container);
        if (!cached) {
          this.cacheOnlineImage(image);
        }
      } catch (error) {
        console.error(`Erro ao carregar imagem ${image.name}:`, error);
      }
    }
  },
  renderOfflineImages: async function(images) {
    const selected = AppState.current.selectedImages.get(AppState.current.currentTab);
    for (const image of images) {
      try {
        const blob = await IndexedDBManager.getImageBlob(image.name);
        console.log('offline render', image.name, 'blob:', blob);
        if (!blob || !(blob instanceof Blob)) continue;
        const url = Utils.createObjectURL(blob);
        const container = this.createImageElement({
          id: image.name,
          name: image.name,
          url,
          isSelected: selected.has(image.name),
          isOnline: false
        });
        this.elements.imageList.appendChild(container);
      } catch (error) {
        console.error(`Erro ao carregar imagem ${image.name}:`, error);
      }
    }
  },
  createImageElement: function({ id, name, url, isSelected, isOnline }) {
    const container = document.createElement('div');
    container.className = `image-container ${isSelected ? 'selected' : ''}`;
    container.dataset.id = id;
    container.setAttribute('role', 'checkbox');
    container.setAttribute('aria-checked', isSelected);
    container.setAttribute('tabindex', '0');
    const checkbox = document.createElement('div');
    checkbox.className = `image-checkbox ${isSelected ? 'checked' : ''}`;
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.toggleImageSelection(id);
      this.updateImageSelection(id, container, checkbox);
    });
    const img = document.createElement('img');
    img.src = url;
    img.alt = Utils.removeFileExtension(name);
    img.loading = 'lazy';
    if (!isOnline) {
      img.dataset.objectUrl = url;
    }
    const nameSpan = document.createElement('span');
    nameSpan.className = 'image-name';
    nameSpan.textContent = Utils.removeFileExtension(name);
    container.addEventListener('click', () => {
      if (AppState.current.isSelectionMode) {
        AppState.toggleImageSelection(id);
        this.updateImageSelection(id, container, checkbox);
      } else {
        this.openFullscreenViewer(url, name);
      }
    });
    container.addEventListener('dblclick', () => {
      if (!AppState.current.isSelectionMode) {
        this.openFullscreenViewer(url, name);
      }
    });
    container.append(checkbox, img, nameSpan);
    return container;
  },
  updateImageSelection: function(id, container, checkbox) {
    const isSelected = AppState.current.selectedImages
      .get(AppState.current.currentTab)
      .has(id);
    container.classList.toggle('selected', isSelected);
    checkbox.classList.toggle('checked', isSelected);
    container.setAttribute('aria-checked', isSelected);
    this.updateSelectionUI();
  },
  
openFullscreenViewer: function(src, alt) {
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
},
  
  updateSelectionUI: function() {
    const tab = AppState.current.currentTab;
    const selectedCount = AppState.current.selectedImages.get(tab).size;
    const totalImages = AppState.current.imageGallery.get(tab).length;
    if (selectedCount > 0) {
      this.elements.floatControls.classList.add('show');
      const allSelected = selectedCount === totalImages;
      this.elements.selectAllBtn.querySelector('span').textContent = 
        allSelected ? 'Desselecionar todas' : 'Selecionar todas';
      this.elements.selectAllBtn.querySelector('i').className = 
        allSelected ? 'far fa-square' : 'fas fa-check-square';
      Utils.showStatus(`${selectedCount} ${selectedCount === 1 ? 'cifra selecionada' : 'cifras selecionadas'}`);
    } else {
      this.elements.floatControls.classList.remove('show');
    }
    this.elements.selectAllBtn.style.display = totalImages <= 1 ? 'none' : 'flex';
  },
  showAddTabDialog: function() {
    const name = prompt('Nome da nova aba:');
    if (name && AppState.addTab(name)) {
      this.renderTabs();
      this.renderImages();
      Utils.showStatus(`Aba "${name}" adicionada.`);
    } else if (name) {
      Utils.showStatus('Nome de aba inválido ou já existente.');
    }
  },
  showRemoveTabDialog: function(tabName) {
    if (confirm(`Remover a aba "${tabName}" e todas as suas cifras?`)) {
      if (AppState.removeTab(tabName)) {
        this.renderTabs();
        this.renderImages();
        Utils.showStatus(`Aba "${tabName}" removida.`);
      }
    }
  },
  showCloudModal: async function() {
    try {
      this.showLoading();
      const files = await DriveManager.searchFiles();
      this.elements.cloudModal.classList.remove('hidden');
      this.renderCloudFileList(files);
      this.elements.cloudSearch.addEventListener('input', () => {
        const query = this.elements.cloudSearch.value.trim().toLowerCase();
        const filtered = query 
          ? files.filter(f => f.name.toLowerCase().includes(query))
          : files;
        this.renderCloudFileList(filtered);
      });
      this.elements.addCloudFilesBtn.addEventListener('click', () => {
        const selected = Array.from(
          this.elements.cloudFileList.querySelectorAll('input:checked')
        ).map(el => el.value);
        if (selected.length > 0) {
          const filesToAdd = files.filter(f => selected.includes(f.id));
          const count = AppState.addImages(filesToAdd.map(f => ({
            id: f.id,
            name: f.name
          })));
          this.elements.cloudModal.classList.add('hidden');
          this.renderImages();
          Utils.showStatus(`${count} cifra(s) adicionada(s) da nuvem.`);
        }
      });
    } catch (error) {
      console.error('Erro ao carregar arquivos da nuvem:', error);
      Utils.showStatus('Erro ao conectar com a nuvem.');
    } finally {
      this.hideLoading();
    }
  },
  renderCloudFileList: function(files) {
    this.elements.cloudFileList.innerHTML = '';
    if (files.length === 0) {
      this.elements.cloudFileList.innerHTML = '<div class="text-center py-4">Nenhum arquivo encontrado</div>';
      return;
    }
    files.forEach(file => {
      const item = document.createElement('label');
      item.className = 'cloud-file-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = file.id;
      const img = document.createElement('img');
      img.src = DriveManager.getThumbnailUrl(file.id);
      img.alt = '';
      img.loading = 'lazy';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = file.name;
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'file-size';
      sizeSpan.textContent = file.size ? Utils.formatBytes(parseInt(file.size)) : '';
      item.append(checkbox, img, nameSpan, sizeSpan);
      this.elements.cloudFileList.appendChild(item);
    });
  },
  cacheOnlineImage: async function(file) {
    try {
      await IndexedDBManager.cacheOnlineImage(AppState.current.currentTab, file);
    } catch (error) {
      console.error('Erro ao armazenar imagem em cache:', error);
    }
  },
  showLoading: function() {
    this.elements.loadingSpinner.classList.add('active');
  },
  hideLoading: function() {
    this.elements.loadingSpinner.classList.remove('active');
  },
  setupEventListeners: function() {
    if (this.elements.openFileDialogBtn && this.elements.fileInput) {
      this.elements.openFileDialogBtn.addEventListener('click', () => {
        if (AppState.current.isOnline) return;
        this.elements.fileInput.value = '';
        this.elements.fileInput.click();
      });
      this.elements.fileInput.addEventListener('change', async (e) => {
        if (AppState.current.isOnline) return;
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        this.showLoading();
        let loadedCount = 0;
        for (const file of files) {
          if (!file.type.startsWith('image/')) continue;
          try {
            const processed = await this.processImageFile(file);
            await IndexedDBManager.addImageBlob(file.name, processed.blob);
            const count = AppState.addImages([{ name: file.name }]);
            if (count > 0) loadedCount++;
          } catch (error) {
            console.error(`Erro ao processar ${file.name}:`, error);
            Utils.showStatus(`Erro ao processar ${file.name}`);
          }
        }
        this.renderImages();
        this.hideLoading();
        Utils.showStatus(`${loadedCount} imagem(ns) carregada(s) com sucesso!`);
      });
    }
    if (this.elements.openCloudBtn && this.elements.cloudModal && this.elements.closeCloudModal) {
      this.elements.openCloudBtn.addEventListener('click', () => this.showCloudModal());
      this.elements.closeCloudModal.addEventListener('click', () => {
        this.elements.cloudModal.classList.add('hidden');
      });
    }
    if (this.elements.modeSwitch && this.elements.modeLabel) {
      this.elements.modeSwitch.addEventListener('change', async () => {
        const isOnline = this.elements.modeSwitch.checked;
        this.showLoading();
        try {
          await AppState.init(isOnline);
          this.renderTabs();
          this.renderImages();
          this.elements.modeLabel.textContent = isOnline ? 'Online' : 'Offline';
        } catch (error) {
          console.error('Erro ao alternar modo:', error);
          Utils.showStatus('Erro ao alternar modo');
          this.elements.modeSwitch.checked = !isOnline;
        } finally {
          this.hideLoading();
        }
      });
    }
    if (this.elements.searchInput) {
      this.elements.searchInput.addEventListener('input', Utils.debounce(() => {
        AppState.searchImages(this.elements.searchInput.value);
        this.renderImages();
      }, 300));
    }
    if (this.elements.selectAllBtn) {
      this.elements.selectAllBtn.addEventListener('click', () => {
        AppState.toggleSelectAll();
        this.renderImages();
      });
    }
    if (this.elements.clearSelectionBtn) {
      this.elements.clearSelectionBtn.addEventListener('click', () => {
        AppState.clearSelection();
        this.renderImages();
      });
    }
    if (this.elements.deleteSelectedBtn) {
      this.elements.deleteSelectedBtn.addEventListener('click', async () => {
        const tab = AppState.current.currentTab;
        const selectedCount = AppState.current.selectedImages.get(tab).size;
        if (selectedCount === 0 || !confirm(`Excluir ${selectedCount} cifra(s) selecionada(s)?`)) {
          return;
        }
        this.showLoading();
        try {
          if (!AppState.current.isOnline) {
            const selected = AppState.current.selectedImages.get(tab);
            const images = AppState.current.imageGallery.get(tab) || [];
            for (const img of images) {
              if (selected.has(img.name)) {
                await IndexedDBManager.deleteImageBlob(img.name);
              }
            }
          }
          const removedCount = AppState.removeSelectedImages();
          this.renderImages();
          Utils.showStatus(`${removedCount} cifra(s) removida(s).`);
        } catch (error) {
          console.error('Erro ao excluir imagens:', error);
          Utils.showStatus('Erro ao excluir imagens.');
        } finally {
          this.hideLoading();
        }
      });
    }
  },
  processImageFile: function(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          blob => {
            URL.revokeObjectURL(url);
            blob ? resolve({ name: file.name, blob }) : reject('Falha ao criar Blob');
          },
          'image/webp',
          0.80
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject('Erro ao carregar imagem');
      };
      img.src = url;
    });
  },
  updateUI: function() {
    this.renderTabs();
    this.renderImages();
    this.updateSelectionUI();
    this.elements.modeSwitch.checked = AppState.current.isOnline;
    this.elements.modeLabel.textContent = AppState.current.isOnline ? 'Online' : 'Offline';
  }
};

// ======== Inicialização ========
async function initializeApp() {
  try {
    UIManager.showLoading();
    await IndexedDBManager.open();
    await IndexedDBManager.clearOldCache();
    await AppState.init(false);
    UIManager.init();
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && AppState.current.imageGallery.has(tabParam)) {
      AppState.switchTab(tabParam);
      UIManager.updateUI();
    }
  } catch (error) {
    console.error('Erro na inicialização:', error);
    Utils.showStatus('Erro ao iniciar o aplicativo. Recarregue a página.');
  } finally {
    UIManager.hideLoading();
  }
}
document.addEventListener('DOMContentLoaded', initializeApp);
