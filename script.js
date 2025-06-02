// Configuração do Firebase (fornecida pelo usuário)
const firebaseConfig = {
  apiKey: "AIzaSyA10_i84FS8v2MmayKmbplHQwjQGnWGczY",
  authDomain: "cifrassite.firebaseapp.com",
  projectId: "cifrassite",
  storageBucket: "https://cifrassite.appspot.com",
  messagingSenderId: "478416827358",
  appId: "1:478416827358:web:7944033bddd8e877dc634f"
};

// Inicializa o Firebase
let firebaseApp, database, storage;
try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    database = firebase.database(); // Referência ao Realtime Database
    storage = firebase.storage();   // Referência ao Cloud Storage
    console.log("Firebase inicializado com sucesso.");
} catch (error) {
    console.error("Erro ao inicializar Firebase:", error);
    // A aplicação continuará, mas o modo online não funcionará.
}

// Cache de elementos DOM
const DOM = {
  tabsContainer: document.getElementById("tabs-container"),
  imageList: document.getElementById("image-list"),
  fileInput: document.getElementById("file-input"),
  openFileDialogButton: document.getElementById("open-file-dialog"),
  deleteSelectedBtn: document.getElementById("delete-selected-btn"),
  clearSelectionBtn: document.getElementById("clear-selection-btn"),
  selectAllBtn: document.getElementById("select-all-btn"),
  floatControls: document.getElementById("float-controls"),
  syncBtn: document.getElementById("sync-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  loadingSpinner: document.getElementById("loading-spinner"),
  statusMessage: document.getElementById("status-message"),
  body: document.body,
  onlineModeSwitch: document.getElementById("online-mode-switch"),
  onlineModeLabel: document.getElementById("online-mode-label")
};

const tabs = [
  "Domingo Manhã", "Domingo Noite", "Segunda", "Quarta", "Culto Jovem", "Santa Ceia", "Outros"
];

// Estado
let imageGalleryByTab = new Map();
let selectedImagesByTab = new Map();
let currentTab = tabs[0];
let isSelectionMode = false;
let dragStartIndex = null;
let isOnlineMode = false; // Começa offline por padrão

tabs.forEach(tab => {
  imageGalleryByTab.set(tab, []);
  selectedImagesByTab.set(tab, new Set());
});

const Utils = {
  removeFileExtension: filename => filename.replace(/\.[^/.]+$/, ""),
  showStatus: message => {
    if (!DOM.statusMessage) return;
    DOM.statusMessage.textContent = message;
    DOM.statusMessage.classList.add("show");
    setTimeout(() => DOM.statusMessage.classList.remove("show"), 3000);
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
    if (url && url.startsWith("blob:") && Utils.objectURLCache.has(url)) {
      URL.revokeObjectURL(url);
      Utils.objectURLCache.delete(url);
    }
  },
  createObjectURL: (blob) => {
    const url = URL.createObjectURL(blob);
    Utils.objectURLCache.set(url, true);
    return url;
  },
  // Função para sanitizar nomes de abas para usar como chaves no Firebase
  sanitizeTabNameForFirebase: (tabName) => tabName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, ""), // Remove espaços e caracteres inválidos
};

// IndexedDB (Mantido para modo offline)
const DB_NAME = "ImageSelectorDB";
const DB_VERSION = 2;
const STORE_IMAGES = "images";
const STORE_METADATA = "metadata";

const IndexedDBManager = {
  db: null,

  open: () => new Promise((resolve, reject) => {
    if (IndexedDBManager.db) {
      resolve(IndexedDBManager.db);
      return;
    }
    // Verifica se indexedDB é suportado
    if (!window.indexedDB) {
        console.warn("IndexedDB não é suportado neste navegador.");
        return reject("IndexedDB not supported");
    }
    try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_IMAGES)) {
            db.createObjectStore(STORE_IMAGES, { keyPath: "name" });
          }
          if (!db.objectStoreNames.contains(STORE_METADATA)) {
            db.createObjectStore(STORE_METADATA, { keyPath: "id" });
          }
        };
        request.onsuccess = (event) => {
          IndexedDBManager.db = event.target.result;
          resolve(IndexedDBManager.db);
        };
        request.onerror = (event) => {
          console.error("IndexedDB error:", event.target.error);
          reject(event.target.error);
        };
    } catch (error) {
        console.error("Falha ao iniciar IndexedDB:", error);
        reject(error);
    }
  }),

  addImageBlob: (imageName, blob) => new Promise(async (resolve, reject) => {
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_IMAGES], "readwrite");
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
      const transaction = db.transaction([STORE_IMAGES], "readonly");
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
      const transaction = db.transaction([STORE_IMAGES], "readwrite");
      const store = transaction.objectStore(STORE_IMAGES);
      const request = store.delete(imageName);
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  }),

  saveMetadata: (state) => new Promise(async (resolve, reject) => {
    if (isOnlineMode) {
        resolve();
        return;
    }
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_METADATA], "readwrite");
      const store = transaction.objectStore(STORE_METADATA);
      // Salva apenas a ordem das imagens e a aba atual no IDB
      const offlineState = {
          images: Object.fromEntries(Array.from(state.images.entries())),
          currentTab: state.currentTab
          // Não salva seleção no IDB, é transitório
      };
      const request = store.put({ id: "appState", state: offlineState });
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  }),

  loadMetadata: () => new Promise(async (resolve, reject) => {
    if (isOnlineMode) {
        resolve(null);
        return;
    }
    try {
      const db = await IndexedDBManager.open();
      const transaction = db.transaction([STORE_METADATA], "readonly");
      const store = transaction.objectStore(STORE_METADATA);
      const request = store.get("appState");
      request.onsuccess = (event) => resolve(event.target.result ? event.target.result.state : null);
      request.onerror = (event) => reject(event.target.error);
    } catch (e) {
      reject(e);
    }
  })
};

// Firebase Manager (Refinado)
const FirebaseManager = {
    // Verifica se o Firebase está disponível
    isAvailable: () => typeof firebase !== "undefined" && database && storage,

    // Obtém a lista de nomes de imagens de uma aba, ordenados
    getImageNames: (tab) => new Promise((resolve, reject) => {
        if (!FirebaseManager.isAvailable()) return reject("Firebase not initialized");
        const safeTabName = Utils.sanitizeTabNameForFirebase(tab);
        const dbRef = database.ref(`tabs/${safeTabName}/images`);
        dbRef.orderByChild("order").once("value") // Ordena pelo campo 'order'
            .then(snapshot => {
                const imagesData = snapshot.val();
                if (imagesData) {
                    // snapshot.forEach preserva a ordem do orderByChild
                    const orderedNames = [];
                    snapshot.forEach(childSnapshot => {
                        orderedNames.push(childSnapshot.key); // A chave é o nome da imagem
                    });
                    resolve(orderedNames);
                } else {
                    resolve([]);
                }
            })
            .catch(error => {
                console.error(`Firebase: Erro ao buscar nomes de imagens para ${tab}:`, error);
                reject(error);
            });
    }),

    // Obtém a URL de download de uma imagem
    getImageUrl: (imageName) => {
        if (!FirebaseManager.isAvailable()) return Promise.reject("Firebase not initialized");
        const storageRef = storage.ref(`images/${imageName}`);
        return storageRef.getDownloadURL();
    },

    // Salva a ordem de todas as imagens em uma aba
    saveImageOrder: (tab, imageNames) => {
        if (!FirebaseManager.isAvailable()) return Promise.reject("Firebase not initialized");
        const safeTabName = Utils.sanitizeTabNameForFirebase(tab);
        const updates = {};
        imageNames.forEach((name, index) => {
            // Codifica o nome da imagem para ser seguro como chave no Firebase
            const safeImageName = encodeURIComponent(name).replace(/\./g, "%2E");
            updates[`tabs/${safeTabName}/images/${safeImageName}/order`] = index;
        });
        // Se não houver imagens, garante que o nó da aba exista mas esteja vazio
        if (imageNames.length === 0) {
             updates[`tabs/${safeTabName}/images`] = null; // Remove o nó de imagens
        }
        return database.ref().update(updates);
    },

    // Faz upload do blob da imagem
    uploadImageBlob: (imageName, blob) => {
        if (!FirebaseManager.isAvailable()) return Promise.reject("Firebase not initialized");
        // Codifica o nome do arquivo para o Storage
        const safeImageName = encodeURIComponent(imageName).replace(/\./g, "%2E");
        const storageRef = storage.ref(`images/${safeImageName}`);
        return storageRef.put(blob); // Retorna UploadTask
    },

    // Exclui imagem (metadados e blob)
    deleteImage: (tab, imageName) => {
        if (!FirebaseManager.isAvailable()) return Promise.reject("Firebase not initialized");
        const safeTabName = Utils.sanitizeTabNameForFirebase(tab);
        const safeImageName = encodeURIComponent(imageName).replace(/\./g, "%2E");
        const dbRef = database.ref(`tabs/${safeTabName}/images/${safeImageName}`);
        const storageRef = storage.ref(`images/${safeImageName}`);

        // Exclui metadados e depois o arquivo no storage
        return dbRef.remove()
            .then(() => storageRef.delete())
            .catch(error => {
                if (error.code === "storage/object-not-found") {
                    console.warn(`Firebase Storage: Objeto ${imageName} não encontrado para exclusão (pode já ter sido removido).`);
                    return; // Considera sucesso se o objeto já não existe
                }
                console.error(`Firebase: Erro ao excluir ${imageName}:`, error);
                throw error;
            });
    },

    // Salva estado geral (aba, modo)
    saveGeneralState: (state) => {
        try {
            localStorage.setItem("appGeneralState", JSON.stringify({
                currentTab: state.currentTab,
                isOnlineMode: state.isOnlineMode
            }));
        } catch (e) {
            console.warn("Não foi possível salvar o estado geral no localStorage:", e);
        }
    },

    // Carrega estado geral
    loadGeneralState: () => {
        try {
            const savedState = localStorage.getItem("appGeneralState");
            return savedState ? JSON.parse(savedState) : null;
        } catch (e) {
            console.warn("Não foi possível carregar o estado geral do localStorage:", e);
            return null;
        }
    }
};


// ImageProcessor (Mantido como está)
const ImageProcessor = {
  processImageFile: file => new Promise((resolve, reject) => {
    const img = new Image();
    const url = Utils.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const MAX_SIZE = 800; // Reduzir um pouco para economizar armazenamento/banda
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
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(blob => {
        Utils.revokeObjectURL(url);
        if (blob) {
          resolve({ name: file.name, blob: blob });
        } else {
          reject(new Error("Falha ao criar Blob da imagem."));
        }
      }, "image/webp", 0.70); // Qualidade ligeiramente menor para WebP
    };

    img.onerror = (err) => {
      Utils.revokeObjectURL(url);
      console.error("Erro ao carregar imagem para processamento:", err);
      reject(new Error("Erro ao carregar a imagem para processamento."));
    };

    img.src = url;
  })
};

// StateManager (Refinado)
const StateManager = {
  // Salva o estado atual (ordem das imagens e estado geral)
  saveState: Utils.debounce(async () => {
    const state = {
      images: imageGalleryByTab, // Passa o Map diretamente
      currentTab,
      isOnlineMode
    };
    try {
      if (isOnlineMode && FirebaseManager.isAvailable()) {
        // Salva a ordem das imagens da aba atual no Firebase DB
        const currentImages = imageGalleryByTab.get(currentTab) || [];
        await FirebaseManager.saveImageOrder(currentTab, currentImages);
        // Salva estado geral (aba, modo) no localStorage
        FirebaseManager.saveGeneralState(state);
      } else if (!isOnlineMode) {
        // Salva metadados (ordem das imagens por aba, aba atual) no IndexedDB
        await IndexedDBManager.saveMetadata(state);
        // Salva estado geral (para lembrar o modo offline)
        FirebaseManager.saveGeneralState(state);
      }
    } catch (e) {
      console.error("Erro ao salvar estado:", e);
      Utils.showStatus("Erro ao salvar dados.");
    }
  }, 500),

  // Carrega o estado inicial da aplicação
  loadState: async () => {
    try {
      // Carrega estado geral (modo online, aba) do localStorage
      const generalState = FirebaseManager.loadGeneralState();
      if (generalState) {
          // Só entra online se Firebase estiver disponível
          isOnlineMode = generalState.isOnlineMode && FirebaseManager.isAvailable();
          currentTab = generalState.currentTab && tabs.includes(generalState.currentTab) ? generalState.currentTab : tabs[0];
      } else {
          isOnlineMode = false; // Começa offline se não houver estado salvo
          currentTab = tabs[0];
      }
      UI.updateOnlineModeSwitch();

      StateManager.initEmptyState(); // Limpa dados locais antes de carregar

      if (isOnlineMode) {
        UI.showLoading();
        console.log("Carregando metadados do Firebase para todas as abas...");
        const promises = tabs.map(async (tab) => {
            try {
                const names = await FirebaseManager.getImageNames(tab);
                imageGalleryByTab.set(tab, names);
            } catch (error) {
                console.error(`Erro ao carregar dados da aba ${tab} do Firebase:`, error);
                imageGalleryByTab.set(tab, []); // Define como vazio em caso de erro
                // Poderia tentar carregar do IDB como fallback?
            }
        });
        await Promise.all(promises);
        console.log("Metadados do Firebase carregados.");
        UI.hideLoading();
      } else {
        // Carrega metadados do IndexedDB
        const state = await IndexedDBManager.loadMetadata();
        if (state && state.images) {
          imageGalleryByTab = new Map(Object.entries(state.images));
          // Garante que todas as abas definidas existam no map
          tabs.forEach(tab => {
              if (!imageGalleryByTab.has(tab)) imageGalleryByTab.set(tab, []);
          });
          currentTab = state.currentTab && tabs.includes(state.currentTab) ? state.currentTab : tabs[0];
        } else {
          StateManager.initEmptyState(); // Se não há nada no IDB
        }
      }
    } catch (e) {
      console.error("Erro crítico ao carregar estado:", e);
      Utils.showStatus("Erro ao carregar dados. Iniciando offline.");
      StateManager.initEmptyState();
      isOnlineMode = false;
      currentTab = tabs[0];
      UI.updateOnlineModeSwitch();
    }
  },

  // Limpa os dados em memória
  initEmptyState: () => {
    imageGalleryByTab = new Map();
    selectedImagesByTab = new Map();
    tabs.forEach(tab => {
      imageGalleryByTab.set(tab, []);
      selectedImagesByTab.set(tab, new Set());
    });
  },

  // Alterna entre modo online e offline
  toggleOnlineMode: async () => {
      const previousMode = isOnlineMode;
      const newMode = !isOnlineMode;

      // Não permite ir online se o Firebase não estiver disponível
      if (newMode && !FirebaseManager.isAvailable()) {
          Utils.showStatus("Erro: Não foi possível conectar ao serviço online.");
          UI.updateOnlineModeSwitch(); // Reverte o switch visualmente
          return;
      }

      isOnlineMode = newMode;
      FirebaseManager.saveGeneralState({ currentTab, isOnlineMode });
      UI.updateOnlineModeSwitch();
      Utils.showStatus(`Mudando para modo ${isOnlineMode ? "Online" : "Offline"}...`);
      UI.showLoading();

      try {
          // Limpa estado e seleção atuais
          StateManager.initEmptyState();
          if (isSelectionMode) ImageManager.exitSelectionModeInstantly();

          // Recarrega o estado da nova fonte
          await StateManager.loadState(); // loadState agora lida com ambos os modos

          // Renderiza as imagens da nova fonte
          await UI.renderImages();
          Utils.showStatus(`Modo ${isOnlineMode ? "Online" : "Offline"} ativado.`);
      } catch (error) {
          console.error("Erro ao alternar modo:", error);
          Utils.showStatus("Erro ao mudar de modo. Revertendo.");
          // Reverte em caso de erro
          isOnlineMode = previousMode;
          FirebaseManager.saveGeneralState({ currentTab, isOnlineMode });
          UI.updateOnlineModeSwitch();
          // Tenta recarregar o estado anterior
          await StateManager.loadState();
          await UI.renderImages();
      } finally {
          UI.hideLoading();
      }
  }
};

// UI (Refinado)
const UI = {
  showLoading: () => DOM.loadingSpinner?.classList.add("active"),
  hideLoading: () => DOM.loadingSpinner?.classList.remove("active"),

  createTabs: () => {
    if (!DOM.tabsContainer) return;
    DOM.tabsContainer.innerHTML = "";
    const fragment = document.createDocumentFragment();
    tabs.forEach((tab, index) => {
      const tabBtn = document.createElement("button");
      tabBtn.className = "tab";
      tabBtn.setAttribute("role", "tab");
      tabBtn.setAttribute("tabindex", index === 0 ? "0" : "-1");
      tabBtn.setAttribute("aria-selected", "false");
      tabBtn.id = `tab-${Utils.sanitizeTabNameForFirebase(tab)}`; // Usa nome sanitizado para ID
      tabBtn.textContent = tab;
      tabBtn.addEventListener("click", () => TabManager.switchTab(tab));
      tabBtn.addEventListener("keydown", (e) => {
        const currentActiveIndex = tabs.indexOf(currentTab);
        let nextIndex = currentActiveIndex;
        if (e.key === "ArrowRight") nextIndex = (currentActiveIndex + 1) % tabs.length;
        else if (e.key === "ArrowLeft") nextIndex = (currentActiveIndex - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") nextIndex = 0;
        else if (e.key === "End") nextIndex = tabs.length - 1;
        if (nextIndex !== currentActiveIndex) {
          e.preventDefault();
          TabManager.switchTab(tabs[nextIndex]);
          DOM.tabsContainer.querySelector(`#tab-${Utils.sanitizeTabNameForFirebase(tabs[nextIndex])}`)?.focus();
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          TabManager.switchTab(tab);
        }
      });
      fragment.appendChild(tabBtn);
    });
    DOM.tabsContainer.appendChild(fragment);
  },

  updateTabsUI: () => {
    if (!DOM.tabsContainer) return;
    const buttons = DOM.tabsContainer.querySelectorAll(".tab");
    buttons.forEach(btn => {
      const isActive = btn.textContent === currentTab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive);
      btn.setAttribute("tabindex", isActive ? "0" : "-1");
    });
  },

  updateOnlineModeSwitch: () => {
      if (DOM.onlineModeSwitch) {
          DOM.onlineModeSwitch.checked = isOnlineMode;
          // Desabilita o switch se o Firebase não estiver disponível
          DOM.onlineModeSwitch.disabled = !FirebaseManager.isAvailable();
      }
      if (DOM.onlineModeLabel) {
          DOM.onlineModeLabel.textContent = isOnlineMode ? "On-line" : "Off-line";
          if (!FirebaseManager.isAvailable()) {
              DOM.onlineModeLabel.textContent += " (Indisponível)";
          }
      }
      DOM.body.classList.toggle("online-mode-active", isOnlineMode);
      DOM.imageList?.classList.toggle("no-drag", isOnlineMode);
  },

  renderImages: async () => {
    if (!DOM.imageList) return;
    // Limpa Object URLs antigos
    DOM.imageList.querySelectorAll("img[data-object-url]").forEach(img => {
      Utils.revokeObjectURL(img.dataset.objectUrl);
    });
    DOM.imageList.innerHTML = "";
    UI.showLoading();

    const imageNames = imageGalleryByTab.get(currentTab) || [];
    const fragment = document.createDocumentFragment();

    if (imageNames.length === 0) {
      const p = document.createElement("p");
      p.className = "text-center text-gray-500 py-8";
      p.textContent = `Nenhuma cifra encontrada em ${currentTab} (${isOnlineMode ? "Online" : "Offline"}).`;
      fragment.appendChild(p);
      DOM.imageList.appendChild(fragment);
    } else {
      // Cria todos os containers primeiro
      imageNames.forEach(name => {
          const container = UI.createImageContainer(name);
          fragment.appendChild(container);
      });
      DOM.imageList.appendChild(fragment);

      // Carrega as imagens de forma assíncrona
      const containers = Array.from(DOM.imageList.querySelectorAll(".image-container"));
      const loadPromises = containers.map(async (container) => {
          const imageName = container.dataset.name;
          const imgElement = container.querySelector("img");
          const loadingIndicator = container.querySelector(".img-loading-indicator");
          try {
              let data = null;
              if (isOnlineMode) {
                  data = await FirebaseManager.getImageUrl(imageName);
              } else {
                  data = await IndexedDBManager.getImageBlob(imageName);
              }

              if (data) {
                  UI.updateImageElement(imgElement, data);
              } else {
                  throw new Error("Dado não encontrado");
              }
          } catch (error) {
              console.error(`Erro ao carregar ${imageName}:`, error);
              container.classList.add("load-error");
              if(imgElement) imgElement.alt = `${Utils.removeFileExtension(imageName)} (Erro)`;
          } finally {
              if(loadingIndicator) loadingIndicator.style.display = "none";
          }
      });
      await Promise.allSettled(loadPromises); // Espera todas carregarem ou falharem
    }

    UI.updateSelectionUI();
    UI.hideLoading();
  },

  createImageContainer: (imageName) => {
    const container = document.createElement("div");
    container.className = "image-container";
    container.setAttribute("draggable", !isOnlineMode);
    container.setAttribute("tabindex", "0");
    container.setAttribute("role", "checkbox");
    container.dataset.name = imageName;

    const selectedSet = selectedImagesByTab.get(currentTab) || new Set();
    const isSelected = selectedSet.has(imageName);
    container.classList.toggle("selected", isSelected);
    container.setAttribute("aria-checked", isSelected);

    const checkbox = document.createElement("div");
    checkbox.className = "image-checkbox";
    checkbox.classList.toggle("checked", isSelected);
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      ImageManager.toggleSelectImage(imageName, container);
    });

    const img = document.createElement("img");
    img.alt = Utils.removeFileExtension(imageName);
    img.loading = "lazy";

    const loadingIndicator = document.createElement("div");
    loadingIndicator.className = "img-loading-indicator";
    // Pode adicionar um spinner SVG ou CSS aqui
    loadingIndicator.innerHTML = 
        `<svg viewBox="0 0 50 50" class="spinner"><circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg>`;

    const nameSpan = document.createElement("span");
    nameSpan.className = "image-name";
    nameSpan.textContent = Utils.removeFileExtension(imageName);

    container.appendChild(checkbox);
    container.appendChild(loadingIndicator);
    container.appendChild(img);
    container.appendChild(nameSpan);

    UI.addImageEventListeners(container, imageName, img);
    return container;
  },

  updateImageElement: (imgElement, blobOrUrl) => {
      let displayUrl;
      if (typeof blobOrUrl === "string") {
          displayUrl = blobOrUrl;
          imgElement.crossOrigin = "anonymous";
      } else {
          displayUrl = Utils.createObjectURL(blobOrUrl);
          imgElement.dataset.objectUrl = displayUrl;
      }
      imgElement.src = displayUrl;
      imgElement.onload = () => { // Garante que a imagem foi carregada antes de interagir
          imgElement.style.opacity = 1; // Mostra a imagem suavemente
      };
      imgElement.onerror = () => {
          imgElement.alt += " (Erro ao exibir)";
          imgElement.parentElement?.classList.add("load-error");
      };
  },

  addImageEventListeners: (container, imageName, imgElement) => {
      container.addEventListener("dblclick", () => {
        if (!isSelectionMode && imgElement.src && !imgElement.parentElement?.classList.contains("load-error")) {
          UI.openFullscreen(imgElement.src, Utils.removeFileExtension(imageName));
        }
      });

      let lastTapTime = 0;
      let tapTimeout = null;
      container.addEventListener("touchend", (e) => {
        if (e.touches && e.touches.length > 1) return;
        const currentTime = new Date().getTime();
        if (currentTime - lastTapTime < 400) {
          clearTimeout(tapTimeout);
          if (!isSelectionMode && imgElement.src && !imgElement.parentElement?.classList.contains("load-error")) {
            UI.openFullscreen(imgElement.src, Utils.removeFileExtension(imageName));
          }
        }
        lastTapTime = currentTime;
        tapTimeout = setTimeout(() => { lastTapTime = 0; }, 450);
      });

      if (!isOnlineMode) {
          let pressTimer;
          container.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            pressTimer = setTimeout(() => {
              if (!isSelectionMode) ImageManager.enterSelectionMode();
              ImageManager.toggleSelectImage(imageName, container);
            }, 500);
          });
          container.addEventListener("mousemove", () => clearTimeout(pressTimer));
          container.addEventListener("mouseup", () => clearTimeout(pressTimer));
          container.addEventListener("mouseleave", () => clearTimeout(pressTimer));

          container.addEventListener("dragstart", (e) => {
            if (!isSelectionMode) {
              ImageManager.enterSelectionMode();
              ImageManager.toggleSelectImage(imageName, container);
            }
            container.classList.add("dragging");
            dragStartIndex = Array.from(DOM.imageList.children).indexOf(container);
            try {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", imageName);
            } catch (err) {
                console.error("Erro ao iniciar drag:", err);
            }
          });
      } else {
          container.addEventListener("click", () => {
              if (isSelectionMode) {
                  ImageManager.toggleSelectImage(imageName, container);
              }
          });
          let pressTimer;
          container.addEventListener("touchstart", (e) => {
              if (e.touches.length > 1) return;
              pressTimer = setTimeout(() => {
                  if (!isSelectionMode) ImageManager.enterSelectionMode();
                  ImageManager.toggleSelectImage(imageName, container);
              }, 700);
          }, { passive: true });
          container.addEventListener("touchend", () => clearTimeout(pressTimer));
          container.addEventListener("touchmove", () => clearTimeout(pressTimer));
           container.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                if (!isSelectionMode) ImageManager.enterSelectionMode();
                ImageManager.toggleSelectImage(imageName, container);
           });
      }
  },

  updateSelectionUI: () => {
    if (!DOM.floatControls) return;
    const selectedSet = selectedImagesByTab.get(currentTab);
    const selectedCount = selectedSet ? selectedSet.size : 0;
    const imageList = imageGalleryByTab.get(currentTab);
    const totalImages = imageList ? imageList.length : 0;

    if (isSelectionMode || selectedCount > 0) {
        DOM.floatControls.classList.add("show");
        const allSelected = totalImages > 0 && selectedCount === totalImages;
        if (DOM.selectAllBtn) {
            DOM.selectAllBtn.querySelector("span").textContent = allSelected ? "Desselecionar todas" : "Selecionar todas";
            DOM.selectAllBtn.querySelector("i").className = allSelected ? "far fa-square" : "fas fa-check-square";
            DOM.selectAllBtn.style.display = totalImages > 0 ? "flex" : "none";
        }
        if (DOM.deleteSelectedBtn) DOM.deleteSelectedBtn.disabled = selectedCount === 0;
        if (DOM.clearSelectionBtn) DOM.clearSelectionBtn.disabled = selectedCount === 0 && !isSelectionMode;

        if (selectedCount > 0) {
            Utils.showStatus(`${selectedCount} ${selectedCount === 1 ? "cifra selecionada" : "cifras selecionadas"}`);
        } else if (isSelectionMode) {
             Utils.showStatus("Modo de seleção ativo. Toque longo ou clique com o botão direito para selecionar.");
        }
    } else {
        DOM.floatControls.classList.remove("show");
    }
  },

  openFullscreen: (src, alt) => {
    const existingOverlay = document.querySelector(".fullscreen-image");
    if (existingOverlay) document.body.removeChild(existingOverlay);

    const overlay = document.createElement("div");
    overlay.className = "fullscreen-image";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `Visualização da imagem ${alt}`);

    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.tabIndex = 0;
    if (src.startsWith("blob:")) {
        img.dataset.objectUrl = src; // Marca para revogar blob URL ao fechar
    }

    // Lógica de zoom e pan (mantida)
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

    img.addEventListener("wheel", (e) => {
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
        translateX = 0; translateY = 0; originX = 0.5; originY = 0.5;
      }
      updateTransform();
    }, { passive: false });
    img.addEventListener("mousedown", (e) => {
      if (scale === 1 || e.button !== 0) return;
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      imgStart = { x: translateX, y: translateY };
      img.style.cursor = "grabbing";
    });
    overlay.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      translateX = imgStart.x + (e.clientX - dragStart.x);
      translateY = imgStart.y + (e.clientY - dragStart.y);
      updateTransform();
    });
    const stopDragging = () => {
        if(isDragging) {
            isDragging = false;
            img.style.cursor = scale > 1 ? "grab" : "default";
        }
    };
    overlay.addEventListener("mouseup", stopDragging);
    overlay.addEventListener("mouseleave", stopDragging);
    img.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        initialPinchDistance = Math.hypot(e.touches[1].pageX - e.touches[0].pageX, e.touches[1].pageY - e.touches[0].pageY);
        lastScale = scale;
        const rect = img.getBoundingClientRect();
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        originX = centerX / rect.width; originY = centerY / rect.height;
      } else if (e.touches.length === 1 && scale > 1) {
        isDragging = true;
        dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        imgStart = { x: translateX, y: translateY };
      }
      // e.preventDefault(); // Evita scroll da página, mas pode interferir em outros gestos
    }, { passive: true }); // Use passive: true se não precisar prevenir default sempre
    img.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2 && initialPinchDistance) {
        e.preventDefault(); // Previne scroll SÓ durante pinch zoom
        const currentPinchDistance = Math.hypot(e.touches[1].pageX - e.touches[0].pageX, e.touches[1].pageY - e.touches[0].pageY);
        let newScale = lastScale * (currentPinchDistance / initialPinchDistance);
        newScale = Math.max(1, Math.min(newScale, 5));
        scale = newScale;
        if (scale === 1) { translateX = 0; translateY = 0; originX = 0.5; originY = 0.5; }
        updateTransform();
      } else if (e.touches.length === 1 && isDragging) {
        e.preventDefault(); // Previne scroll SÓ durante drag
        translateX = imgStart.x + (e.touches[0].clientX - dragStart.x);
        translateY = imgStart.y + (e.touches[0].clientY - dragStart.y);
        updateTransform();
      }
    }, { passive: false });
    img.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) initialPinchDistance = null;
      if (e.touches.length < 1) isDragging = false;
    });

    // Fechar fullscreen
    const closeFullscreen = () => {
        if (img.dataset.objectUrl) {
            Utils.revokeObjectURL(img.dataset.objectUrl);
        }
        document.removeEventListener("keydown", handleEscKey);
        document.body.removeChild(overlay);
    };
    const handleEscKey = (e) => {
        if (e.key === "Escape") {
            closeFullscreen();
        }
    };
    document.addEventListener("keydown", handleEscKey);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeFullscreen();
    });
    let lastOverlayTapTime = 0;
    let overlayTapTimeout = null;
    overlay.addEventListener("touchend", (e) => {
      if (e.target !== overlay) return;
      const currentTime = new Date().getTime();
      if (currentTime - lastOverlayTapTime < 400) {
        clearTimeout(overlayTapTimeout);
        closeFullscreen();
      }
      lastOverlayTapTime = currentTime;
      overlayTapTimeout = setTimeout(() => { lastOverlayTapTime = 0; }, 450);
    });
    const closeButton = document.createElement("button");
    closeButton.className = "close-fullscreen-btn";
    closeButton.innerHTML = "&times;";
    closeButton.setAttribute("aria-label", "Fechar visualização");
    closeButton.onclick = closeFullscreen;
    overlay.appendChild(closeButton);

    overlay.appendChild(img);
    document.body.appendChild(overlay);
    img.focus();
    if(scale > 1) img.style.cursor = "grab";
  }
};

// TabManager (Refinado)
const TabManager = {
  switchTab: async tabName => {
    if (currentTab === tabName) return;
    currentTab = tabName;
    UI.updateTabsUI();

    // Limpa seleção da aba anterior
    const previousSelectedSet = selectedImagesByTab.get(currentTab);
    if (previousSelectedSet) previousSelectedSet.clear();
    if (isSelectionMode) ImageManager.exitSelectionModeInstantly(); // Sai do modo sem re-renderizar ainda

    await UI.renderImages(); // Renderiza imagens da nova aba
    StateManager.saveState(); // Salva o estado (nova aba ativa)
  }
};

// ImageManager (Refinado)
const ImageManager = {
  enterSelectionMode: () => {
    if(isSelectionMode) return;
    isSelectionMode = true;
    DOM.body.classList.add("selection-mode");
    UI.updateSelectionUI();
  },
  // Sai do modo de seleção e re-renderiza
  exitSelectionMode: () => {
    if(!isSelectionMode) return;
    isSelectionMode = false;
    DOM.body.classList.remove("selection-mode");
    const selectedSet = selectedImagesByTab.get(currentTab);
    if (selectedSet) selectedSet.clear();
    UI.renderImages(); // Re-renderiza para limpar visualmente
  },
  // Sai do modo instantaneamente, sem re-renderizar (útil antes de trocar aba/modo)
  exitSelectionModeInstantly: () => {
      if (!isSelectionMode) return;
      isSelectionMode = false;
      DOM.body.classList.remove("selection-mode");
      const selectedSet = selectedImagesByTab.get(currentTab);
      if (selectedSet) selectedSet.clear();
      UI.updateSelectionUI(); // Apenas atualiza os botões
  },
  toggleSelectImage: (imageName, container) => {
    const selectedSet = selectedImagesByTab.get(currentTab);
    if (!selectedSet) return;
    const isSelected = selectedSet.has(imageName);

    if (isSelected) {
      selectedSet.delete(imageName);
    } else {
      selectedSet.add(imageName);
    }
    container.classList.toggle("selected", !isSelected);
    container.setAttribute("aria-checked", !isSelected);
    container.querySelector(".image-checkbox")?.classList.toggle("checked", !isSelected);

    UI.updateSelectionUI();
  },
  deleteImage: async imageName => {
    if (!confirm(`Tem certeza que deseja excluir a cifra "${Utils.removeFileExtension(imageName)}"? Esta ação não pode ser desfeita.`)) return;
    UI.showLoading();
    try {
      const currentImages = Array.from(imageGalleryByTab.get(currentTab) || []);
      const indexToRemove = currentImages.indexOf(imageName);
      if (indexToRemove === -1) throw new Error("Imagem não encontrada na lista local.");

      // Remove da lista local primeiro para UI responder rápido
      currentImages.splice(indexToRemove, 1);
      imageGalleryByTab.set(currentTab, currentImages);
      selectedImagesByTab.get(currentTab)?.delete(imageName);

      // Atualiza a UI imediatamente
      await UI.renderImages();

      // Tenta excluir do backend (Firebase ou IDB)
      if (isOnlineMode) {
        await FirebaseManager.deleteImage(currentTab, imageName);
        // Salva a nova ordem no Firebase
        await FirebaseManager.saveImageOrder(currentTab, currentImages);
      } else {
        await IndexedDBManager.deleteImageBlob(imageName);
        // Salva metadados atualizados no IDB
        StateManager.saveState();
      }

      Utils.showStatus("Cifra excluída com sucesso!");
    } catch (error) {
      console.error("Erro ao excluir cifra:", error);
      Utils.showStatus("Erro ao excluir cifra. Recarregando...");
      // Recarrega o estado em caso de erro para garantir consistência
      await StateManager.loadState();
      await UI.renderImages();
    } finally {
      UI.hideLoading();
    }
  },
  reorderImages: async (fromIndex, toIndex) => {
    if (isOnlineMode) {
        Utils.showStatus("Reordenação manual indisponível no modo Online.");
        return;
    }
    const images = imageGalleryByTab.get(currentTab) || [];
    if (fromIndex < 0 || fromIndex >= images.length || toIndex < 0 || toIndex >= images.length) return;

    const movedImageName = images.splice(fromIndex, 1)[0];
    images.splice(toIndex, 0, movedImageName);
    imageGalleryByTab.set(currentTab, images);

    selectedImagesByTab.get(currentTab)?.clear();
    if (isSelectionMode) ImageManager.exitSelectionModeInstantly();

    await UI.renderImages(); // Re-renderiza com a nova ordem
    StateManager.saveState(); // Salva a nova ordem no IDB
  },
  deleteSelected: async () => {
    const selectedSet = selectedImagesByTab.get(currentTab);
    if (!selectedSet || selectedSet.size === 0) return;
    const selectedNames = Array.from(selectedSet);
    const count = selectedNames.length;

    if (!confirm(`Excluir ${count} cifra(s) selecionada(s)? Esta ação não pode ser desfeita.`)) return;
    UI.showLoading();
    let errors = 0;

    // Remove da lista local primeiro
    let currentImages = imageGalleryByTab.get(currentTab) || [];
    const remainingImages = currentImages.filter(name => !selectedSet.has(name));
    imageGalleryByTab.set(currentTab, remainingImages);
    selectedSet.clear();
    const originalSelectionMode = isSelectionMode;
    if (isSelectionMode) ImageManager.exitSelectionModeInstantly();

    // Atualiza UI
    await UI.renderImages();

    try {
        // Tenta excluir do backend
        const deletePromises = selectedNames.map(name => {
            if (isOnlineMode) {
                return FirebaseManager.deleteImage(currentTab, name).catch(err => { errors++; console.error(`Erro Firebase delete ${name}:`, err); });
            } else {
                return IndexedDBManager.deleteImageBlob(name).catch(err => { errors++; console.error(`Erro IDB delete ${name}:`, err); });
            }
        });
        await Promise.allSettled(deletePromises);

        // Salva o estado final (nova ordem / metadados)
        if (isOnlineMode) {
            await FirebaseManager.saveImageOrder(currentTab, remainingImages);
        } else {
            StateManager.saveState();
        }

        if (errors > 0) {
            Utils.showStatus(`${count - errors} de ${count} cifras excluídas. ${errors} falharam.`);
            // Se houve erros, recarrega para garantir consistência
            throw new Error("Falha ao excluir algumas cifras do backend.");
        } else {
            Utils.showStatus(`${count} cifra(s) excluída(s) com sucesso.`);
        }
    } catch (error) {
      console.error("Erro ao excluir selecionados:", error);
      Utils.showStatus("Erro ao excluir cifras. Recarregando...");
      await StateManager.loadState();
      await UI.renderImages();
    } finally {
      UI.hideLoading();
    }
  },
  clearSelection: () => {
    const selectedSet = selectedImagesByTab.get(currentTab);
    if (selectedSet && selectedSet.size > 0) {
        selectedSet.clear();
        if (isSelectionMode) ImageManager.exitSelectionMode();
        else UI.renderImages(); // Apenas re-renderiza se não estava em modo de seleção
        Utils.showStatus("Seleção limpa.");
    } else if (isSelectionMode) {
        ImageManager.exitSelectionMode();
    }
  },
  toggleSelectAll: () => {
    const allNames = imageGalleryByTab.get(currentTab) || [];
    const selectedSet = selectedImagesByTab.get(currentTab);
    if (!selectedSet || allNames.length === 0) return;

    const allSelected = selectedSet.size === allNames.length;
    if (allSelected) {
        selectedSet.clear();
    } else {
        allNames.forEach(name => selectedSet.add(name));
        if (!isSelectionMode) ImageManager.enterSelectionMode();
    }
    UI.renderImages();
  },
  handleFileSelection: async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    UI.showLoading();

    if (!imageGalleryByTab.has(currentTab)) imageGalleryByTab.set(currentTab, []);

    const currentImageNames = imageGalleryByTab.get(currentTab) || [];
    const currentImageNamesLower = new Set(currentImageNames.map(n => n.toLowerCase()));
    let loadedCount = 0;
    let skippedCount = 0;
    let errors = 0;
    const newImageNames = []; // Para adicionar ao final no modo online

    try {
        const processAndSavePromises = files.map(async (file) => {
            if (!file.type.startsWith("image/")) return;

            // Verifica duplicatas (case-insensitive)
            if (currentImageNamesLower.has(file.name.toLowerCase())) {
                console.warn(`Cifra "${file.name}" já existe nesta aba. Pulando.`);
                skippedCount++;
                return;
            }

            try {
                const processed = await ImageProcessor.processImageFile(file);
                if (!processed) return;

                if (isOnlineMode) {
                    await FirebaseManager.uploadImageBlob(processed.name, processed.blob);
                    newImageNames.push(processed.name); // Adiciona à lista para salvar ordem depois
                } else {
                    await IndexedDBManager.addImageBlob(processed.name, processed.blob);
                    // Adiciona diretamente na lista local offline
                    currentImageNames.push(processed.name);
                    currentImageNamesLower.add(processed.name.toLowerCase());
                }
                loadedCount++;
            } catch (error) {
                errors++;
                console.error(`Erro ao processar/salvar ${file.name}:`, error);
                Utils.showStatus(`Erro ao carregar ${file.name}`);
            }
        });

        await Promise.allSettled(processAndSavePromises);

        // Se online, atualiza a lista local e salva a nova ordem no Firebase
        if (isOnlineMode && newImageNames.length > 0) {
            const finalNames = [...currentImageNames, ...newImageNames];
            imageGalleryByTab.set(currentTab, finalNames);
            await FirebaseManager.saveImageOrder(currentTab, finalNames);
        }

        await UI.renderImages();

        // Salva estado do IDB se offline
        if (!isOnlineMode) {
            StateManager.saveState();
        }

        // Monta mensagem de status final
        let statusMsg = "";
        if (loadedCount > 0) statusMsg += `${loadedCount} cifra(s) carregada(s). `;
        if (skippedCount > 0) statusMsg += `${skippedCount} duplicada(s) ignorada(s). `;
        if (errors > 0) statusMsg += `${errors} falharam.`;
        if (statusMsg === "") statusMsg = "Nenhuma cifra nova para carregar.";
        Utils.showStatus(statusMsg.trim());

    } catch (error) {
      console.error("Erro geral ao carregar arquivos:", error);
      Utils.showStatus("Erro ao carregar cifras.");
    } finally {
      UI.hideLoading();
      DOM.fileInput.value = ""; // Limpa input para permitir selecionar mesmo arquivo
    }
  }
};

// EventManager (Refinado)
const EventManager = {
  setup: () => {
    // Drag and Drop (Só offline)
    DOM.imageList?.addEventListener("dragover", (e) => {
      if (isOnlineMode) return;
      e.preventDefault();
      const afterElement = getDragAfterElement(DOM.imageList, e.clientY);
      const draggable = DOM.imageList.querySelector(".dragging");
      if (!draggable) return;
      DOM.imageList.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      if (afterElement) afterElement.classList.add("drag-over");
      else { // Adiciona ao final se não houver elemento depois
          const lastElement = DOM.imageList.querySelector(".image-container:last-child:not(.dragging)");
          if(lastElement) lastElement.classList.add("drag-over-end");
      }
    });
    DOM.imageList?.addEventListener("dragleave", (e) => {
        // Remove highlights ao sair da lista
        DOM.imageList.querySelectorAll(".drag-over, .drag-over-end").forEach(el => el.classList.remove("drag-over", "drag-over-end"));
    });
    DOM.imageList?.addEventListener("drop", (e) => {
      if (isOnlineMode) return;
      e.preventDefault();
      const draggable = DOM.imageList.querySelector(".dragging");
      DOM.imageList.querySelectorAll(".drag-over, .drag-over-end").forEach(el => el.classList.remove("drag-over", "drag-over-end"));
      if (!draggable) return;
      draggable.classList.remove("dragging");

      const afterElement = getDragAfterElement(DOM.imageList, e.clientY);
      const containers = Array.from(DOM.imageList.children);
      const fromIndex = containers.indexOf(draggable);
      let toIndex = afterElement ? containers.indexOf(afterElement) : containers.length; // Se não houver afterElement, vai para o fim

      if (fromIndex < toIndex) toIndex--; // Ajuste se movendo para baixo

      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
          ImageManager.reorderImages(fromIndex, toIndex);
      }
    });
    function getDragAfterElement(container, y) {
      const draggableElements = [...container.querySelectorAll(".image-container:not(.dragging)")];
      return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
      }, { offset: -Infinity, element: null }).element;
    }

    // Botões flutuantes
    DOM.clearSelectionBtn?.addEventListener("click", ImageManager.clearSelection);
    DOM.deleteSelectedBtn?.addEventListener("click", ImageManager.deleteSelected);
    DOM.selectAllBtn?.addEventListener("click", ImageManager.toggleSelectAll);

    // Upload
    DOM.openFileDialogButton?.addEventListener("click", () => {
      DOM.fileInput.value = "";
      DOM.fileInput?.click();
    });
    DOM.fileInput?.addEventListener("change", ImageManager.handleFileSelection);

    // Sync/Settings (Placeholders)
    DOM.syncBtn?.addEventListener("click", async () => {
        if (isOnlineMode) {
            Utils.showStatus("Forçando sincronização com nuvem...");
            UI.showLoading();
            await StateManager.loadState(); // Recarrega do Firebase
            await UI.renderImages();
            UI.hideLoading();
            Utils.showStatus("Sincronização concluída.");
        } else {
            Utils.showStatus("Sincronização só disponível no modo Online.");
        }
    });
    DOM.settingsBtn?.addEventListener("click", () => {
      Utils.showStatus("Funcionalidade de Configurações em desenvolvimento...");
    });

    // Switch Online/Offline
    if (DOM.onlineModeSwitch) {
        DOM.onlineModeSwitch.addEventListener("change", StateManager.toggleOnlineMode);
    }

    // Tecla ESC para sair do modo de seleção
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && isSelectionMode) {
            ImageManager.clearSelection();
        }
    });
  }
};

// Função de inicialização (Final)
async function init() {
  UI.showLoading();
  console.log("Iniciando aplicação Cifras...");
  try {
    // Tenta abrir IndexedDB
    try {
        await IndexedDBManager.open();
        console.log("IndexedDB pronto.");
    } catch (idbError) {
        console.warn("IndexedDB indisponível:", idbError);
        Utils.showStatus("Aviso: Armazenamento local (offline) indisponível.");
    }

    // Carrega o estado (define modo, aba e dados iniciais)
    console.log("Carregando estado...");
    await StateManager.loadState();
    console.log(`Estado carregado. Modo: ${isOnlineMode ? "Online" : "Offline"}, Aba: ${currentTab}`);

    // Configura a UI inicial
    console.log("Configurando UI...");
    UI.createTabs();
    UI.updateTabsUI();
    UI.updateOnlineModeSwitch();

    // Renderiza as imagens iniciais
    console.log("Renderizando imagens...");
    await UI.renderImages();
    console.log("Imagens renderizadas.");

    // Configura os event listeners
    console.log("Configurando eventos...");
    EventManager.setup();
    console.log("Eventos configurados.");

    console.log("Aplicação Cifras inicializada com sucesso.");

  } catch (e) {
    console.error("Erro fatal na inicialização:", e);
    UI.hideLoading();
    document.body.innerHTML = 
        `<div style="padding: 20px; text-align: center; color: red;">
            <h1>Erro Crítico</h1>
            <p>Ocorreu um erro inesperado ao iniciar a aplicação.</p>
            <p>Verifique o console do navegador para mais detalhes (F12) e tente recarregar a página.</p>
            <p>Se o problema persistir, o serviço online pode estar temporariamente indisponível.</p>
        </div>`;
  } finally {
     // Garante que o loading suma mesmo se houver erro antes de UI.hideLoading ser chamado
     UI.hideLoading();
  }
}

// Inicia a aplicação quando o DOM estiver pronto
document.addEventListener("DOMContentLoaded", init);