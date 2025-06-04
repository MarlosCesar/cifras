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
            request.onsuccess = function (event) {
                const cursor = event.target.result;
                if (cursor) {
                    if (cursor.value.lastCached < threshold) {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };
            request.onerror = function (event) {
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
    // Abas padrão
    defaultTabs: [
        "Domingo Manhã", "Domingo Noite", "Segunda",
        "Quarta", "Culto Jovem", "Santa Ceia"
    ],

    // Estado atual
    current: {
        tabs: [],
        userTabs: [],
        imageGallery: new Map(), // {tab: [{id, name, url, cached?}]}
        selectedImages: new Map(), // {tab: Set(id)}
        currentTab: null,
        isOnline: false,
        isSelectionMode: false,
        searchQuery: ''
    },

    // Inicialização
    init: async function (isOnline = false) {
        this.current.isOnline = isOnline;
        await this.loadState(isOnline);

        // Garante que as abas padrão existam
        this.defaultTabs.forEach(tab => {
            if (!this.current.imageGallery.has(tab)) {
                this.current.imageGallery.set(tab, []);
                this.current.selectedImages.set(tab, new Set());
            }
        });

        if (!this.current.currentTab || !this.current.imageGallery.has(this.current.currentTab)) {
            this.current.currentTab = this.defaultTabs[0];
        }
    },

    // Carregar estado
    loadState: async function (isOnline) {
        try {
            const state = await IndexedDBManager.loadMetadata(isOnline);

            if (state && state.state) {
                this.current.tabs = [...this.defaultTabs, ...(state.state.userTabs || [])];
                this.current.userTabs = state.state.userTabs || [];
                this.current.currentTab = state.state.currentTab || this.defaultTabs[0];

                // Converter objetos para Map
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

    // Salvar estado
    saveState: Utils.debounce(async () => {
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

    // Resetar estado
    resetState: function () {
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

    // Adicionar nova aba
    addTab: function (name) {
        name = name.trim();
        if (!name || this.current.tabs.includes(name)) return false;

        this.current.userTabs.push(name);
        this.current.tabs.push(name);
        this.current.imageGallery.set(name, []);
        this.current.selectedImages.set(name, new Set());
        this.current.currentTab = name;

        this.saveState();
        return true;
    },

    // Remover aba
    removeTab: function (name) {
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

    // Alternar aba atual
    switchTab: function (tabName) {
        if (this.current.currentTab === tabName || !this.current.imageGallery.has(tabName)) return;

        this.current.currentTab = tabName;
        this.saveState();
    },

    // Adicionar imagens
    addImages: function (images) {
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
            this.saveState();
        }

        return newImages.length;
    },

    // Remover imagens selecionadas
    removeSelectedImages: function () {
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

    // Alternar seleção de imagem
    toggleImageSelection: function (imageId) {
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

    // Selecionar todas/desselecionar todas
    toggleSelectAll: function () {
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

    // Limpar seleção
    clearSelection: function () {
        const tab = this.current.currentTab;
        this.current.selectedImages.get(tab).clear();
        this.current.isSelectionMode = false;
        this.saveState();
    },

    // Buscar imagens
    searchImages: function (query) {
        this.current.searchQuery = query.toLowerCase().trim();
    },

    // Obter imagens filtradas
    getFilteredImages: function () {
        const tab = this.current.currentTab;
        const images = this.current.imageGallery.get(tab) || [];

        if (!this.current.searchQuery) return images;

        return images.filter(img =>
            img.name.toLowerCase().includes(this.current.searchQuery)
        );
    }
};

// ======== Gerenciador de UI ========
const UIManager = {
    // Elementos DOM
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

    // Inicialização
    init: function () {
        this.renderTabs();
        this.renderImages();
        this.setupEventListeners();
        this.updateUI();
    },
    // Renderizar abas das cifras
    renderTabs: function () {
        // Limpa as abas existentes
        this.elements.tabsContainer.innerHTML = '';

        // Para cada aba do usuário
        AppState.current.userTabs.forEach((tab, idx) => {
            const tabElement = document.createElement('button');
            tabElement.textContent = tab;
            tabElement.className = 'tab px-4 py-2 rounded-t focus:outline-none';
            // Adiciona a classe 'active' se for a aba atual
            if (AppState.current.currentTab === tab) {
                tabElement.classList.add('active', 'bg-blue-500', 'text-white');
            } else {
                tabElement.classList.add('bg-gray-200', 'text-gray-700');
            }
            // Handler de clique: troca a aba e rerenderiza as imagens e abas!
            tabElement.addEventListener('click', () => {
                AppState.switchTab(tab);
                UIManager.renderTabs();      // <- Para atualizar o visual das abas
                UIManager.renderImages();    // <- Para atualizar a lista de cifras
            });
            this.elements.tabsContainer.appendChild(tabElement);
        });

        // Botão de adicionar aba (opcional)
        const addTabBtn = document.createElement('button');
        addTabBtn.textContent = '+';
        addTabBtn.className = 'tab px-4 py-2 rounded-t bg-green-500 text-white focus:outline-none ml-2';
        addTabBtn.addEventListener('click', () => {
            UIManager.showAddTabDialog();
        });
        this.elements.tabsContainer.appendChild(addTabBtn);
    },


    // Navegação por teclado nas abas
    handleTabKeyNavigation: function (e, tab, index) {
        const allTabs = [...AppState.current.tabs, '+'];

        switch (e.key) {
            case 'ArrowRight':
                e.preventDefault();
                const nextIndex = (index + 1) % allTabs.length;
                const nextTab = allTabs[nextIndex];
                if (nextTab !== '+') {
                    AppState.switchTab(nextTab);
                    this.elements.tabsContainer.children[nextIndex].focus();
                }
                break;

            case 'ArrowLeft':
                e.preventDefault();
                const prevIndex = (index - 1 + allTabs.length) % allTabs.length;
                const prevTab = allTabs[prevIndex];
                if (prevTab !== '+') {
                    AppState.switchTab(prevTab);
                    this.elements.tabsContainer.children[prevIndex].focus();
                }
                break;

            case 'Home':
                e.preventDefault();
                AppState.switchTab(allTabs[0]);
                this.elements.tabsContainer.children[0].focus();
                break;

            case 'End':
                e.preventDefault();
                const lastIndex = allTabs.length - 2; // Ignora o botão '+'
                AppState.switchTab(allTabs[lastIndex]);
                this.elements.tabsContainer.children[lastIndex].focus();
                break;
        }
    },

    // Renderizar imagens
    renderImages: async function () {
        this.elements.imageList.innerHTML = '';
        const images = AppState.getFilteredImages();

        // Limpar URLs de objetos antigos
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

    // Renderizar imagens online
    renderOnlineImages: async function (images) {
        const selected = AppState.current.selectedImages.get(AppState.current.currentTab);

        for (const image of images) {
            try {
                // Verificar se a imagem está em cache
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

                // Pré-carregar imagem completa em segundo plano
                if (!cached) {
                    this.cacheOnlineImage(image);
                }
            } catch (error) {
                console.error(`Erro ao carregar imagem ${image.name}:`, error);
            }
        }
    },

    // Renderizar imagens offline
    renderOfflineImages: async function (images) {
        const selected = AppState.current.selectedImages.get(AppState.current.currentTab);
        for (const image of images) {
            try {
                const blob = await IndexedDBManager.getImageBlob(image.name);
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

    // Criar elemento de imagem
    createImageElement: function ({ id, name, url, isSelected, isOnline }) {
        const container = document.createElement('div');
        container.className = `image-container ${isSelected ? 'selected' : ''}`;
        container.dataset.id = id;
        container.setAttribute('role', 'checkbox');
        container.setAttribute('aria-checked', isSelected);
        container.setAttribute('tabindex', '0');

        // Checkbox de seleção
        const checkbox = document.createElement('div');
        checkbox.className = `image-checkbox ${isSelected ? 'checked' : ''}`;
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            AppState.toggleImageSelection(id);
            this.updateImageSelection(id, container, checkbox);
        });

        // Imagem
        const img = document.createElement('img');
        img.src = url;
        img.alt = Utils.removeFileExtension(name);
        img.loading = 'lazy';

        if (!isOnline) {
            img.dataset.objectUrl = url;
        }

        // Nome da imagem
        const nameSpan = document.createElement('span');
        nameSpan.className = 'image-name';
        nameSpan.textContent = Utils.removeFileExtension(name);

        // Eventos
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

        // Adicionar elementos ao container
        container.append(checkbox, img, nameSpan);

        return container;
    },

    // Atualizar seleção de imagem
    updateImageSelection: function (id, container, checkbox) {
        const isSelected = AppState.current.selectedImages
            .get(AppState.current.currentTab)
            .has(id);

        container.classList.toggle('selected', isSelected);
        checkbox.classList.toggle('checked', isSelected);
        container.setAttribute('aria-checked', isSelected);
        this.updateSelectionUI();
    },

    // Visualizador em tela cheia
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

    // Atualizar UI de seleção
    updateSelectionUI: function () {
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

    // Mostrar diálogo para adicionar aba
    showAddTabDialog: function () {
        const name = prompt('Nome da nova aba:');
        if (name && AppState.addTab(name)) {
            this.renderTabs();
            this.renderImages();
            Utils.showStatus(`Aba "${name}" adicionada.`);
        } else if (name) {
            Utils.showStatus('Nome de aba inválido ou já existente.');
        }
    },

    // Mostrar diálogo para remover aba
    showRemoveTabDialog: function (tabName) {
        if (confirm(`Remover a aba "${tabName}" e todas as suas cifras?`)) {
            if (AppState.removeTab(tabName)) {
                this.renderTabs();
                this.renderImages();
                Utils.showStatus(`Aba "${tabName}" removida.`);
            }
        }
    },

    // Mostrar modal da nuvem
    showCloudModal: async function () {
        try {
            this.showLoading();
            const files = await DriveManager.searchFiles();

            this.elements.cloudModal.classList.remove('hidden');
            this.renderCloudFileList(files);

            // Configurar busca
            this.elements.cloudSearch.addEventListener('input', () => {
                const query = this.elements.cloudSearch.value.trim().toLowerCase();
                const filtered = query
                    ? files.filter(f => f.name.toLowerCase().includes(query))
                    : files;
                this.renderCloudFileList(filtered);
            });

            // Configurar botão de adicionar
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

    // Renderizar lista de arquivos na nuvem
    renderCloudFileList: function (files) {
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

    // Cache de imagem online
    cacheOnlineImage: async function (file) {
        try {
            await IndexedDBManager.cacheOnlineImage(AppState.current.currentTab, file);
        } catch (error) {
            console.error('Erro ao armazenar imagem em cache:', error);
        }
    },

    // Mostrar/ocultar loading
    showLoading: function () {
        this.elements.loadingSpinner.classList.add('active');
    },

    hideLoading: function () {
        this.elements.loadingSpinner.classList.remove('active');
    },

    // Configurar event listeners
    setupEventListeners: function () {
        // Upload de arquivos
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

        // Nuvem
        if (this.elements.openCloudBtn && this.elements.cloudModal && this.elements.closeCloudModal) {
        this.elements.openCloudBtn.addEventListener('click', () => this.showCloudModal());
        this.elements.closeCloudModal.addEventListener('click', () => {
        this.elements.cloudModal.classList.add('hidden');
        });
        }
    }
