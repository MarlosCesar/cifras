// --- Utilidades e IndexedDB ---
const Utils = {
  removeFileExtension: filename => filename.replace(/\.[^/.]+$/, ""),
  showStatus: (message) => {
    const el = document.getElementById('status-message');
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }
};

const DB_NAME = 'CifrasDBv3';
const DB_VERSION = 1;
const STORE_IMAGES = 'images';
const STORE_METADATA = 'metadata';
const STORE_ONLINE = 'onlineImages';

const IndexedDBManager = {
  db: null,
  open: () => new Promise((resolve, reject) => {
    if (IndexedDBManager.db) return resolve(IndexedDBManager.db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_IMAGES))
        db.createObjectStore(STORE_IMAGES, { keyPath: 'name' });
      if (!db.objectStoreNames.contains(STORE_ONLINE))
        db.createObjectStore(STORE_ONLINE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_METADATA))
        db.createObjectStore(STORE_METADATA, { keyPath: 'id' });
    };
    req.onsuccess = e => { IndexedDBManager.db = e.target.result; resolve(IndexedDBManager.db); };
    req.onerror = e => reject(e.target.error);
  }),
  saveOffline: (tabMap, selectedMap, currentTab, userTabs) => IndexedDBManager.open().then(db => {
    const tx = db.transaction([STORE_METADATA], 'readwrite');
    const obj = { id: 'appState', state: { images: Object.fromEntries(tabMap), selected: Object.fromEntries(selectedMap), currentTab, userTabs } };
    tx.objectStore(STORE_METADATA).put(obj);
    return tx.complete;
  }),
  loadOffline: () => IndexedDBManager.open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_METADATA], 'readonly');
    const req = tx.objectStore(STORE_METADATA).get('appState');
    req.onsuccess = () => resolve(req.result ? req.result.state : null);
    req.onerror = e => reject(e.target.error);
  })),
  saveOnline: (tabMap, selectedMap, currentTab, userTabs) => IndexedDBManager.open().then(db => {
    const tx = db.transaction([STORE_ONLINE], 'readwrite');
    const obj = { id: 'onlineState', state: { images: Object.fromEntries(tabMap), selected: Object.fromEntries(selectedMap), currentTab, userTabs } };
    tx.objectStore(STORE_ONLINE).put(obj);
    return tx.complete;
  }),
  loadOnline: () => IndexedDBManager.open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ONLINE], 'readonly');
    const req = tx.objectStore(STORE_ONLINE).get('onlineState');
    req.onsuccess = () => resolve(req.result ? req.result.state : null);
    req.onerror = e => reject(e.target.error);
  }))
};

// --- Estado do App ---
const tabs = [
  "Domingo Manhã", "Domingo Noite", "Segunda", "Quarta", "Culto Jovem", "Santa Ceia"
];
let userTabs = [];
let imageGalleryByTab = new Map();
let selectedImagesByTab = new Map();
let currentTab = tabs[0];
let isSelectionMode = false;
let isOnlineMode = false;

// --- DOM ---
const DOM = {
  tabsContainer: document.getElementById('tabs-container'),
  imageList: document.getElementById('image-list'),
  fileInput: document.getElementById('file-input'),
  openFileDialogButton: document.getElementById('open-file-dialog'),
  openCloudFolderButton: document.getElementById('open-cloud-folder'),
  modalNuvem: document.getElementById('modal-nuvem'),
  closeModalNuvem: document.getElementById('close-modal-nuvem'),
  filtroCifra: document.getElementById('filtro-cifra'),
  listaCifras: document.getElementById('lista-cifras'),
  incluirCifrasBtn: document.getElementById('incluir-cifras-btn'),
  selectAllBtn: document.getElementById('select-all-btn'),
  clearSelectionBtn: document.getElementById('clear-selection-btn'),
  deleteSelectedBtn: document.getElementById('delete-selected-btn'),
  floatControls: document.getElementById('float-controls'),
  loadingSpinner: document.getElementById('loading-spinner'),
  statusMessage: document.getElementById('status-message'),
  modeSwitch: document.getElementById('online-switch'),
  modeLabel: document.getElementById('online-status-label')
};

// --- Google Drive API ---
async function buscarArquivosGoogleDrive() {
  const API_KEY = window.GDRIVE_API_KEY;
  const FOLDER_ID = window.GDRIVE_FOLDER_ID;
  if (!API_KEY || !FOLDER_ID) {
    Utils.showStatus("Configuração da API do Google Drive ausente.");
    return [];
  }
  let arquivos = [];
  let pageToken = '';
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q='${FOLDER_ID}'+in+parents+and+trashed=false&fields=nextPageToken,files(id,name,mimeType,webContentLink,webViewLink)&key=${API_KEY}&pageSize=1000`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.files) arquivos.push(...data.files.filter(f => f.mimeType.startsWith('image/')));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return arquivos;
}

// --- UI Tabs ---
function criarTabs() {
  DOM.tabsContainer.innerHTML = '';
  const allTabs = [...tabs, ...userTabs, "+"];
  allTabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (tab === currentTab ? ' active' : '');
    btn.textContent = tab;
    btn.onclick = () => {
      if (tab === "+") {
        let name = prompt("Nome da nova aba:");
        if (!name) return;
        name = name.trim();
        if (!name || tabs.includes(name) || userTabs.includes(name) || name === "+") {
          Utils.showStatus("Nome de aba inválido ou já existente.");
          return;
        }
        userTabs.push(name);
        imageGalleryByTab.set(name, []);
        selectedImagesByTab.set(name, new Set());
        currentTab = name;
        criarTabs();
        renderImages();
        salvarEstado();
      } else {
        currentTab = tab;
        criarTabs();
        renderImages();
      }
    };
    if (userTabs.includes(tab)) {
      btn.style.position = "relative";
      const closeBtn = document.createElement('span');
      closeBtn.textContent = "×";
      closeBtn.title = "Remover aba";
      closeBtn.className = "close-tab-btn";
      closeBtn.onclick = e => {
        e.stopPropagation();
        imageGalleryByTab.delete(tab);
        selectedImagesByTab.delete(tab);
        userTabs = userTabs.filter(t => t !== tab);
        if (currentTab === tab) currentTab = tabs[0];
        criarTabs();
        renderImages();
        salvarEstado();
      };
      btn.appendChild(closeBtn);
    }
    DOM.tabsContainer.appendChild(btn);
  });
}

// --- Renderização das Imagens (Offline/Online unificados) ---
async function renderImages() {
  DOM.imageList.innerHTML = '';
  let imageObjs = [];
  if (isOnlineMode) {
    // Online: cada aba armazena array de objetos {id, name}
    imageObjs = (imageGalleryByTab.get(currentTab) || []);
  } else {
    // Offline: array de nomes
    imageObjs = (imageGalleryByTab.get(currentTab) || []).map(name => ({name}));
  }
  if (!imageObjs.length) {
    const p = document.createElement('p');
    p.className = 'text-center text-gray-500 py-8';
    p.textContent = 'Nenhuma cifra adicionada.';
    DOM.imageList.appendChild(p);
    return;
  }
  for (const item of imageObjs) {
    let url, name = item.name;
    if (isOnlineMode) {
      url = `https://drive.google.com/uc?id=${item.id}`;
    } else {
      const blob = await IndexedDBManager.open().then(db => new Promise((res, rej) => {
        const tx = db.transaction([STORE_IMAGES], 'readonly');
        const req = tx.objectStore(STORE_IMAGES).get(name);
        req.onsuccess = () => res(req.result ? req.result.blob : null);
        req.onerror = e => rej(e.target.error);
      }));
      if (!blob) continue;
      url = URL.createObjectURL(blob);
    }
    const container = document.createElement('div');
    container.className = 'image-container';
    const img = document.createElement('img');
    img.src = url;
    img.alt = Utils.removeFileExtension(name);
    img.title = name;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'image-name';
    nameSpan.textContent = Utils.removeFileExtension(name);
    container.append(img, nameSpan);
    DOM.imageList.appendChild(container);
  }
}

// --- Modal Nuvem (sempre disponível) ---
function abrirModalNuvem(arquivos) {
  DOM.modalNuvem.classList.remove('hidden');
  renderizarListaCifras(arquivos, []);
  DOM.filtroCifra.value = '';
  let arquivosFiltrados = arquivos;
  DOM.filtroCifra.oninput = () => {
    const palavra = DOM.filtroCifra.value.trim().toLowerCase();
    arquivosFiltrados = arquivos.filter(a => a.name.toLowerCase().includes(palavra));
    renderizarListaCifras(arquivosFiltrados, []);
  };
  DOM.incluirCifrasBtn.onclick = async () => {
    const selecionados = Array.from(DOM.listaCifras.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    if (!selecionados.length) return;
    const novas = arquivosFiltrados.filter(a => selecionados.includes(a.id)).map(a => ({id: a.id, name: a.name}));
    let tabArr = imageGalleryByTab.get(currentTab) || [];
    // Garante não duplicar
    const jaIds = new Set((isOnlineMode ? tabArr.map(f => f.id) : tabArr));
    const novosFinal = novas.filter(f => isOnlineMode ? !jaIds.has(f.id) : !jaIds.has(f.name));
    if (isOnlineMode) {
      imageGalleryByTab.set(currentTab, tabArr.concat(novosFinal));
    } else {
      imageGalleryByTab.set(currentTab, tabArr.concat(novosFinal.map(f => f.name)));
    }
    salvarEstado();
    fecharModalNuvem();
    renderImages();
  };
}

function fecharModalNuvem() {
  DOM.modalNuvem.classList.add('hidden');
}

function renderizarListaCifras(arquivos, selecionados) {
  DOM.listaCifras.innerHTML = '';
  if (!arquivos.length) {
    DOM.listaCifras.innerHTML = '<div>Nenhuma cifra encontrada.</div>';
    return;
  }
  arquivos.forEach(arq => {
    const label = document.createElement('label');
    label.className = 'cifra-checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = arq.id;
    input.checked = selecionados.includes(arq.id);
    label.appendChild(input);
    const span = document.createElement('span');
    span.textContent = arq.name;
    label.appendChild(span);
    DOM.listaCifras.appendChild(label);
  });
}

// --- Event Listeners ---
function setupListeners() {
  DOM.openFileDialogButton.onclick = () => {
    if (isOnlineMode) return;
    DOM.fileInput.value = '';
    DOM.fileInput.click();
  };
  DOM.fileInput.onchange = async (e) => {
    if (isOnlineMode) return;
    const files = Array.from(e.target.files);
    if (!files.length) return;
    let loaded = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const blob = file;
      await IndexedDBManager.open().then(db => {
        const tx = db.transaction([STORE_IMAGES], 'readwrite');
        tx.objectStore(STORE_IMAGES).put({ name: file.name, blob });
        return tx.complete;
      });
      let tabArr = imageGalleryByTab.get(currentTab) || [];
      if (!tabArr.includes(file.name)) {
        tabArr.push(file.name);
        imageGalleryByTab.set(currentTab, tabArr);
      }
      loaded++;
    }
    renderImages();
    salvarEstado();
    Utils.showStatus(`${loaded} imagem(ns) carregada(s)!`);
  };
  DOM.openCloudFolderButton.onclick = async () => {
    DOM.loadingSpinner.classList.remove('hidden');
    try {
      const arquivos = await buscarArquivosGoogleDrive();
      abrirModalNuvem(arquivos);
    } catch {
      Utils.showStatus("Erro ao buscar cifras na nuvem.");
    } finally {
      DOM.loadingSpinner.classList.add('hidden');
    }
  };
  DOM.closeModalNuvem.onclick = fecharModalNuvem;
  DOM.modeSwitch.onchange = () => {
    isOnlineMode = DOM.modeSwitch.checked;
    DOM.modeLabel.textContent = isOnlineMode ? "Online" : "Offline";
    if (isOnlineMode) {
      carregarOnline().then(() => { criarTabs(); renderImages(); });
    } else {
      carregarOffline().then(() => { criarTabs(); renderImages(); });
    }
  };
}

// --- Estado/Carregamento ---
async function salvarEstado() {
  if (isOnlineMode)
    await IndexedDBManager.saveOnline(imageGalleryByTab, selectedImagesByTab, currentTab, userTabs);
  else
    await IndexedDBManager.saveOffline(imageGalleryByTab, selectedImagesByTab, currentTab, userTabs);
}
async function carregarOffline() {
  let state = await IndexedDBManager.loadOffline();
  if (state) {
    imageGalleryByTab = new Map(Object.entries(state.images || {}));
    selectedImagesByTab = new Map();
    for (const tab of [...tabs, ...(state.userTabs || [])])
      selectedImagesByTab.set(tab, new Set(state.selected?.[tab] || []));
    currentTab = state.currentTab || tabs[0];
    userTabs = state.userTabs || [];
  } else {
    imageGalleryByTab = new Map();
    selectedImagesByTab = new Map();
    tabs.forEach(tab => {
      imageGalleryByTab.set(tab, []);
      selectedImagesByTab.set(tab, new Set());
    });
    userTabs = [];
  }
}
async function carregarOnline() {
  let state = await IndexedDBManager.loadOnline();
  if (state) {
    imageGalleryByTab = new Map(Object.entries(state.images || {}));
    selectedImagesByTab = new Map();
    for (const tab of [...tabs, ...(state.userTabs || [])])
      selectedImagesByTab.set(tab, new Set(state.selected?.[tab] || []));
    currentTab = state.currentTab || tabs[0];
    userTabs = state.userTabs || [];
  } else {
    imageGalleryByTab = new Map();
    selectedImagesByTab = new Map();
    tabs.forEach(tab => {
      imageGalleryByTab.set(tab, []);
      selectedImagesByTab.set(tab, new Set());
    });
    userTabs = [];
  }
}

// --- Inicialização ---
async function init() {
  isOnlineMode = false;
  await carregarOffline();
  criarTabs();
  renderImages();
  setupListeners();
}
document.addEventListener('DOMContentLoaded', init);
