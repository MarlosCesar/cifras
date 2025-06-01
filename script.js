// ================================
// Importação e inicialização do Firebase (v9 modular)
// ================================
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyA10_i84FS8v2MmayKmbplHQwjQGnWGczY",
  authDomain: "cifrassite.firebaseapp.com",
  projectId: "cifrassite",
  storageBucket: "cifrassite.appspot.com",
  messagingSenderId: "478416827358",
  appId: "1:478416827358:web:7944033bddd8e877dc634f"
};

const firebaseApp = initializeApp(firebaseConfig);
const firestore = getFirestore(firebaseApp);

const ONLINE_COLLECTION = "cifras-selecionadas";
const ONLINE_DOC = "unico";

// ================================
// Cache de elementos DOM
// ================================
const DOM = {
  tabsContainer: document.getElementById('tabs-container'),
  imageList: document.getElementById('image-list'),
  fileInput: document.getElementById('file-input'),
  openFileDialogButton: document.getElementById('open-file-dialog'),
  deleteSelectedBtn: document.getElementById('delete-selected-btn'),
  clearSelectionBtn: document.getElementById('clear-selection-btn'),
  selectAllBtn: document.getElementById('select-all-btn'),
  floatControls: document.getElementById('float-controls'),
  loadingSpinner: document.getElementById('loading-spinner'),
  statusMessage: document.getElementById('status-message'),
  body: document.body,
  onlineSwitch: document.getElementById('online-switch'),
  onlineStatusLabel: document.getElementById('online-status-label'),
};

// ================================
// Configurações e Estado
// ================================
const tabs = [
  "Domingo Manhã", "Domingo Noite", "Segunda", "Quarta", "Culto Jovem", "Santa Ceia", "Outros"
];

let imageGalleryByTab = new Map();
let selectedImagesByTab = new Map();
let currentTab = tabs[0];
let isSelectionMode = false;
let dragStartIndex = null;
let onlineMode = false;

// Inicializa estados para todas as abas
tabs.forEach(tab => {
  imageGalleryByTab.set(tab, []);
  selectedImagesByTab.set(tab, new Set());
});

// ================================
// Utilitários
// ================================
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

// ================================
// IndexedDB
// ================================
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

  addImageBlob: (tab, imageName, blob) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_IMAGES], 'readwrite');
      const store = transaction.objectStore(STORE_IMAGES);
      const key = `${tab}:${imageName}`;
      const request = store.put({ name: key, blob: blob });
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  }),

  getImageBlob: (tab, imageName) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_IMAGES], 'readonly');
      const store = transaction.objectStore(STORE_IMAGES);
      const key = `${tab}:${imageName}`;
      const request = store.get(key);
      request.onsuccess = (event) => resolve(event.target.result ? event.target.result.blob : null);
      request.onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  }),

  deleteImageBlob: (tab, imageName) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_IMAGES], 'readwrite');
      const store = transaction.objectStore(STORE_IMAGES);
      const key = `${tab}:${imageName}`;
      const request = store.delete(key);
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

// ================================
// Image Processing
// ================================
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

// ================================
// State Management
// ================================
const StateManager = {
  saveState: Utils.debounce(async () => {
    const state = {
      images: Object.fromEntries(Array.from(imageGalleryByTab.entries()).map(([tab, names]) => [tab, Array.from(names)])),
      selected: Object.fromEntries(Array.from(selectedImagesByTab.entries()).map(([tab, set]) => [tab, Array.from(set)])),
      currentTab,
    };
    if (onlineMode) {
      await saveOnlineState(imageGalleryByTab, selectedImagesByTab, currentTab);
    } else {
      await IndexedDBManager.saveMetadata(state);
    }
  }, 500),

  loadState: async () => {
    if (onlineMode) {
      await loadOnlineState();
    } else {
      try {
        const state = await IndexedDBManager.loadMetadata();
        if (state) {
          imageGalleryByTab = new Map(Object.entries(state.images || {}));
          selectedImagesByTab = new Map();
          for (const tab of tabs) {
            if (!imageGalleryByTab.has(tab)) imageGalleryByTab.set(tab, []);
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
    }
  },

  initEmptyState: () => {
    imageGalleryByTab = new Map();
    selectedImagesByTab = new Map();
    tabs.forEach(tab => {
      imageGalleryByTab.set(tab, []);
      selectedImagesByTab.set(tab, new Set());
    });
    currentTab = tabs[0];
  }
};

// ================================
// Firebase Online/Offline Switch
// ================================
function setOnlineMode(active) {
  onlineMode = active;
  if (onlineMode) {
    if (DOM.onlineStatusLabel) {
      DOM.onlineStatusLabel.textContent = "Online";
      DOM.onlineStatusLabel.classList.remove("text-gray-700");
      DOM.onlineStatusLabel.classList.add("text-blue-600");
    }
  } else {
    if (DOM.onlineStatusLabel) {
      DOM.onlineStatusLabel.textContent = "Off-line";
      DOM.onlineStatusLabel.classList.remove("text-blue-600");
      DOM.onlineStatusLabel.classList.add("text-gray-700");
    }
  }
  StateManager.loadState().then(() => {
    UI.createTabs();
    UI.updateTabsUI();
    UI.renderImages();
  });
}

if (DOM.onlineSwitch) {
  DOM.onlineSwitch.addEventListener('change', function () {
    setOnlineMode(this.checked);
  });
}

// ================================
// Firestore Save/Load
// ================================
async function saveOnlineState(imagesMap, selectedMap, currentTab) {
  const imagesObj = {};
  const selectedObj = {};
  for (const tab of tabs) {
    imagesObj[tab] = Array.from(imagesMap.get(tab));
    selectedObj[tab] = Array.from(selectedMap.get(tab));
  }
  await setDoc(doc(firestore, ONLINE_COLLECTION, ONLINE_DOC), {
    imagesObj,
    selectedObj,
    currentTab,
  });
}

async function loadOnlineState() {
  const docRef = doc(firestore, ONLINE_COLLECTION, ONLINE_DOC);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const state = docSnap.data();
    imageGalleryByTab = new Map();
    selectedImagesByTab = new Map();
    for (const tab of tabs) {
      imageGalleryByTab.set(tab, state.imagesObj?.[tab] || []);
      selectedImagesByTab.set(tab, new Set(state.selectedObj?.[tab] || []));
    }
    currentTab = state.currentTab || tabs[0];
  } else {
    for (const tab of tabs) {
      imageGalleryByTab.set(tab, []);
      selectedImagesByTab.set(tab, new Set());
    }
    currentTab = tabs[0];
  }
}

// ================================
// UI
// ================================
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
      for (const imageName of imageNames) {
        const blob = await IndexedDBManager.getImageBlob(currentTab, imageName);
        if (blob) {
          const container = UI.createImageElement(imageName, blob);
          fragment.appendChild(container);
        } else {
          imageGalleryByTab.set(currentTab, imageNames.filter(name => name !== imageName));
          selectedImagesByTab.get(currentTab).delete(imageName);
        }
      }
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
      ImageManager.toggleSelectImage(imageName);
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

    // Seleção e drag and drop
    let pressTimer;
    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      pressTimer = setTimeout(() => {
        if (!isSelectionMode) {
          ImageManager.enterSelectionMode();
        }
        ImageManager.toggleSelectImage(imageName);
      }, 400);
    });
    container.addEventListener('mouseup', () => { clearTimeout(pressTimer); });
    container.addEventListener('mouseleave', () => { clearTimeout(pressTimer); });

    container.addEventListener('dragstart', (e) => {
      if (!isSelectionMode) {
        ImageManager.enterSelectionMode();
        ImageManager.toggleSelectImage(imageName);
      }
      container.classList.add('dragging');
      dragStartIndex = Array.from(DOM.imageList.children).indexOf(container);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', imageName);
    });

    // Double click abre fullscreen
    container.addEventListener('dblclick', () => {
      if (!isSelectionMode) {
        UI.openFullscreen(objectURL, Utils.removeFileExtension(imageName));
      }
    });

    return container;
  },

  updateSelectionUI: () => {
    const selectedCount = selectedImagesByTab.get(currentTab).size;
    const totalImages = imageGalleryByTab.get(currentTab).length;
    if (selectedCount > 0) {
      DOM.floatControls.classList.add('show');
      const allSelected = selectedCount === totalImages;
      const span = DOM.selectAllBtn.querySelector('span');
      if (span) span.textContent = allSelected ? 'Desselecionar todas' : 'Selecionar todas';
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
    overlay.appendChild(img);

    overlay.onclick = () => {
      document.body.removeChild(overlay);
      Utils.revokeObjectURL(img.src);
    };

    document.body.appendChild(overlay);
  }
};

// ================================
// Tab Manager
// ================================
const TabManager = {
  switchTab: async tabName => {
    if (currentTab === tabName) return;
    currentTab = tabName;
    UI.updateTabsUI();
    await UI.renderImages();
    StateManager.saveState();
  }
};

// ================================
// Image Manager
// ================================
const ImageManager = {
  enterSelectionMode: () => {
    isSelectionMode = true;
    DOM.body.classList.add('selection-mode');
  },
  exitSelectionMode: () => {
    isSelectionMode = false;
    DOM.body.classList.remove('selection-mode');
  },
  toggleSelectImage: (imageName) => {
    const selectedSet = selectedImagesByTab.get(currentTab);
    if (selectedSet.has(imageName)) {
      selectedSet.delete(imageName);
    } else {
      selectedSet.add(imageName);
    }
    UI.renderImages();
    StateManager.saveState();
  },
  deleteSelected: async () => {
    const selectedNames = Array.from(selectedImagesByTab.get(currentTab));
    const count = selectedNames.length;
    if (!count || !confirm(`Excluir ${count} imagem(ns) selecionada(s)?`)) return;
    UI.showLoading();
    try {
      for (const name of selectedNames) {
        await IndexedDBManager.deleteImageBlob(currentTab, name);
      }
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
          await IndexedDBManager.addImageBlob(currentTab, processed.name, processed.blob);
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

// ================================
// Event Manager
// ================================
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
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        const images = imageGalleryByTab.get(currentTab);
        const movedImageName = images.splice(fromIndex, 1)[0];
        images.splice(toIndex, 0, movedImageName);
        imageGalleryByTab.set(currentTab, images);
        selectedImagesByTab.get(currentTab).clear();
        ImageManager.exitSelectionMode();
        UI.renderImages();
        StateManager.saveState();
      }
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
  }
};

// ================================
// Inicialização
// ================================
async function init() {
  UI.showLoading();
  try {
    await IndexedDBManager.open();
    // Inicializa estado como offline, a não ser que o switch esteja ativo:
    setOnlineMode(DOM.onlineSwitch && DOM.onlineSwitch.checked);
    EventManager.setup();
  } catch (e) {
    Utils.showStatus("Erro ao iniciar o aplicativo. Tente recarregar a página.");
  } finally {
    UI.hideLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
