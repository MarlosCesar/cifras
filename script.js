// ================================
// CONFIGURAÇÃO FIREBASE (SUBSTITUA PELOS SEUS DADOS!)
// ================================
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA10_i84FS8v2MmayKmbplHQwjQGnWGczY",
  authDomain: "cifrassite.firebaseapp.com",
  projectId: "cifrassite",
  storageBucket: "cifrassite.firebasestorage.app",
  messagingSenderId: "478416827358",
  appId: "1:478416827358:web:7944033bddd8e877dc634f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ================================
// VARIÁVEIS GLOBAIS
// ================================
const tabs = ["Domingo Manhã", "Domingo Noite", "Segunda", "Quarta", "Culto Jovem", "Santa Ceia", "Outros"];
let imageGalleryByTab = new Map();
let selectedImagesByTab = new Map();
let currentTab = tabs[0];
let isSelectionMode = false;
let dragStartIndex = null;

// ================================
// IndexedDB helpers
// ================================
const DB_NAME = 'CifrasDB', DB_VERSION = 1, STORE_IMAGES = 'images', STORE_STATE = 'state';
const IndexedDB = {
  db: null,
  open: () => new Promise((res, rej) => {
    if (IndexedDB.db) return res(IndexedDB.db);
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_IMAGES)) db.createObjectStore(STORE_IMAGES, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE, { keyPath: 'key' });
    };
    r.onsuccess = e => { IndexedDB.db = e.target.result; res(IndexedDB.db); };
    r.onerror = e => rej(e.target.error);
  }),
  putImage: (key, blob) => IndexedDB.open().then(db => new Promise((res, rej) => {
    const tx = db.transaction([STORE_IMAGES], 'readwrite');
    tx.objectStore(STORE_IMAGES).put({ key, blob });
    tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
  })),
  getImage: key => IndexedDB.open().then(db => new Promise((res, rej) => {
    const tx = db.transaction([STORE_IMAGES], 'readonly');
    const req = tx.objectStore(STORE_IMAGES).get(key);
    req.onsuccess = () => res(req.result ? req.result.blob : null);
    req.onerror = e => rej(e.target.error);
  })),
  deleteImage: key => IndexedDB.open().then(db => new Promise((res, rej) => {
    const tx = db.transaction([STORE_IMAGES], 'readwrite');
    tx.objectStore(STORE_IMAGES).delete(key);
    tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
  })),
  saveState: state => IndexedDB.open().then(db => new Promise((res, rej) => {
    const tx = db.transaction([STORE_STATE], 'readwrite');
    tx.objectStore(STORE_STATE).put({ key: "state", ...state });
    tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
  })),
  loadState: () => IndexedDB.open().then(db => new Promise((res, rej) => {
    const tx = db.transaction([STORE_STATE], 'readonly');
    const req = tx.objectStore(STORE_STATE).get("state");
    req.onsuccess = () => res(req.result || null);
    req.onerror = e => rej(e.target.error);
  }))
};

// ================================
// HELPERS DE UI
// ================================
function showLoading(show) {
  document.getElementById('loading-spinner').classList.toggle('active', show);
}
function showStatus(msg) {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}
function showSelectionControls(show) {
  const el = document.getElementById('selection-controls');
  if (el) el.style.display = show ? "flex" : "none";
}

// ================================
// ESTADO LOCAL (IndexedDB)
// ================================
function saveLocalState() {
  const imagesObj = {};
  tabs.forEach(tab => imagesObj[tab] = imageGalleryByTab.get(tab));
  const selectedObj = {};
  tabs.forEach(tab => selectedObj[tab] = Array.from(selectedImagesByTab.get(tab)));
  IndexedDB.saveState({ imagesObj, selectedObj, currentTab });
}
async function loadLocalState() {
  showLoading(true);
  const state = await IndexedDB.loadState();
  restoreAppState(state);
  renderTabs();
  await renderImages();
  showLoading(false);
}

// ================================
// RESTAURAÇÃO DE ESTADO (sempre garante todos os tabs)
// ================================
function restoreAppState(state) {
  if (!state) {
    tabs.forEach(tab => {
      imageGalleryByTab.set(tab, []);
      selectedImagesByTab.set(tab, new Set());
    });
    currentTab = tabs[0];
    return;
  }
  tabs.forEach(tab => {
    imageGalleryByTab.set(tab, Array.isArray(state.imagesObj?.[tab]) ? state.imagesObj[tab] : []);
    selectedImagesByTab.set(tab, new Set(Array.isArray(state.selectedObj?.[tab]) ? state.selectedObj[tab] : []));
  });
  currentTab = state.currentTab || tabs[0];
}

// ================================
// RENDERIZAÇÃO DE ABAS
// ================================
function renderTabs() {
  const tabsContainer = document.getElementById('tabs-container');
  tabsContainer.innerHTML = "";
  tabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = "tab" + (currentTab === tab ? " active" : "");
    btn.textContent = tab;
    btn.onclick = () => {
      currentTab = tab;
      renderTabs();
      renderImages();
      saveLocalState();
    };
    tabsContainer.appendChild(btn);
  });
}

// ================================
// RENDERIZAÇÃO DAS IMAGENS
// ================================
async function renderImages() {
  const list = document.getElementById('image-list');
  list.innerHTML = "";
  const names = imageGalleryByTab.get(currentTab) || [];
  if (!names.length) {
    list.innerHTML = `<p class="text-center text-gray-500 py-8">Nenhuma cifra adicionada.</p>`;
    showSelectionControls(false);
    return;
  }
  for (let name of names) {
    const blob = await IndexedDB.getImage(`${currentTab}:${name}`);
    if (!blob) continue;
    const container = createImageElement(name, blob);
    list.appendChild(container);
  }
  updateSelectionControls();
}

// ================================
// CRIAÇÃO DE ELEMENTO DA IMAGEM (com seleção, drag, long press)
// ================================
function createImageElement(imageName, imageBlob) {
  const container = document.createElement('div');
  container.className = 'image-container';
  container.setAttribute('draggable', 'true');
  container.setAttribute('tabindex', '0');
  container.setAttribute('role', 'checkbox');
  container.setAttribute('aria-checked', selectedImagesByTab.get(currentTab).has(imageName));
  container.dataset.name = imageName;
  if (selectedImagesByTab.get(currentTab).has(imageName)) container.classList.add('selected');

  // Checkbox visual
  const checkbox = document.createElement('div');
  checkbox.className = 'image-checkbox';
  if (selectedImagesByTab.get(currentTab).has(imageName)) checkbox.classList.add('checked');
  checkbox.onclick = e => { e.stopPropagation(); toggleSelect(imageName); };
  container.appendChild(checkbox);

  // Imagem
  const img = document.createElement('img');
  const objectURL = URL.createObjectURL(imageBlob);
  img.src = objectURL;
  img.alt = imageName;
  container.appendChild(img);

  // Nome
  const span = document.createElement('span');
  span.className = 'image-name';
  span.textContent = imageName.replace(/\.[^/.]+$/, "");
  container.appendChild(span);

  // Long press (mobile) ou mouse para seleção/drag
  let longPressTimeout = null;
  let dragActivated = false;
  let isDragging = false;

  // Mobile: long-press para seleção ou drag
  container.addEventListener('touchstart', function (e) {
    if (e.touches.length > 1) return;
    dragActivated = false;
    isDragging = false;
    longPressTimeout = setTimeout(() => {
      isSelectionMode = true;
      toggleSelect(imageName);
      updateSelectionControls();
    }, 400);
  }, { passive: true });

  container.addEventListener('touchmove', function (e) {
    clearTimeout(longPressTimeout);
  }, { passive: true });

  container.addEventListener('touchend', function (e) {
    clearTimeout(longPressTimeout);
    if (!isSelectionMode) openFullscreen(img.src, imageName);
  }, { passive: true });

  // Desktop: long-press ou click para seleção
  container.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    longPressTimeout = setTimeout(() => {
      isSelectionMode = true;
      toggleSelect(imageName);
      updateSelectionControls();
    }, 400);
  });
  container.addEventListener('mouseup', function () {
    clearTimeout(longPressTimeout);
    if (!isSelectionMode) openFullscreen(img.src, imageName);
  });
  container.addEventListener('mouseleave', function () {
    clearTimeout(longPressTimeout);
  });

  // Drag & drop HTML5 para desktop
  container.addEventListener('dragstart', function (e) {
    dragStartIndex = Array.from(document.getElementById('image-list').children).indexOf(container);
    isDragging = true;
    container.classList.add('dragging');
  });

  container.addEventListener('dragend', function () {
    isDragging = false;
    container.classList.remove('dragging');
  });

  return container;
}

// ================================
// DRAG & DROP CONTAINER LISTENERS
// ================================
document.getElementById('image-list').addEventListener('dragover', function (e) {
  e.preventDefault();
  const dragging = document.querySelector('.dragging');
  if (!dragging) return;
  const after = getDragAfterElement(this, e.clientY);
  this.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (after) after.classList.add('drag-over');
});
document.getElementById('image-list').addEventListener('drop', function (e) {
  e.preventDefault();
  const dragging = document.querySelector('.dragging');
  if (!dragging) return;
  const containers = Array.from(this.children);
  const fromIndex = containers.indexOf(dragging);
  const after = getDragAfterElement(this, e.clientY);
  let toIndex = after ? containers.indexOf(after) : containers.length - 1;
  if (fromIndex < toIndex) toIndex--;
  reorderImages(fromIndex, toIndex);
  dragging.classList.remove('dragging');
  this.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  selectedImagesByTab.get(currentTab).clear();
  isSelectionMode = false;
  renderImages();
});
function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('.image-container:not(.dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    else return closest;
  }, { offset: -Infinity, element: null }).element;
}
function reorderImages(fromIndex, toIndex) {
  const arr = imageGalleryByTab.get(currentTab) || [];
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  const [item] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, item);
  imageGalleryByTab.set(currentTab, arr);
  saveLocalState();
}

// ================================
// SELEÇÃO (selecionar, limpar, todas)
// ================================
function toggleSelect(name) {
  const set = selectedImagesByTab.get(currentTab);
  if (set.has(name)) set.delete(name);
  else set.add(name);
  renderImages();
  saveLocalState();
}
function clearSelection() {
  selectedImagesByTab.get(currentTab).clear();
  isSelectionMode = false;
  renderImages();
  saveLocalState();
}
function selectAll() {
  const set = selectedImagesByTab.get(currentTab);
  const names = imageGalleryByTab.get(currentTab) || [];
  if (set.size === names.length) set.clear();
  else names.forEach(name => set.add(name));
  isSelectionMode = set.size > 0;
  renderImages();
  saveLocalState();
}
function deleteSelected() {
  const set = selectedImagesByTab.get(currentTab);
  if (!set.size) return;
  if (!confirm(`Excluir ${set.size} cifra(s) selecionada(s)?`)) return;
  showLoading(true);
  const names = Array.from(set);
  Promise.all(names.map(name => IndexedDB.deleteImage(`${currentTab}:${name}`)))
    .then(() => {
      imageGalleryByTab.set(currentTab, imageGalleryByTab.get(currentTab).filter(name => !set.has(name)));
      set.clear();
      renderImages();
      saveLocalState();
      showStatus("Cifras excluídas!");
    })
    .finally(() => showLoading(false));
}

// ================================
// CONTROLES DE SELEÇÃO DINÂMICOS
// ================================
function updateSelectionControls() {
  const set = selectedImagesByTab.get(currentTab);
  const total = (imageGalleryByTab.get(currentTab) || []).length;
  if (!document.getElementById('selection-controls')) return;
  showSelectionControls(set.size > 0);
  const selectAllBtn = document.getElementById('select-all-btn');
  if (selectAllBtn) {
    if (total > 1) selectAllBtn.style.display = "inline-flex";
    else selectAllBtn.style.display = "none";
    const span = selectAllBtn.querySelector('span');
    if (span) span.textContent = set.size === total ? 'Desselecionar todas' : 'Selecionar todas';
  }
}

// ================================
// IMPORTAÇÃO LOCAL
// ================================
document.getElementById('open-file-dialog').onclick = () => {
  document.getElementById('file-input').click();
};
document.getElementById('file-input').onchange = async function (e) {
  showLoading(true);
  const files = Array.from(e.target.files);
  for (let file of files) {
    const reader = new FileReader();
    await new Promise(resolve => {
      reader.onload = () => {
        IndexedDB.putImage(`${currentTab}:${file.name}`, new Blob([reader.result]));
        if (!imageGalleryByTab.get(currentTab).includes(file.name)) {
          imageGalleryByTab.get(currentTab).push(file.name);
        }
        resolve();
      };
      reader.readAsArrayBuffer(file);
    });
  }
  renderImages();
  saveLocalState();
  showLoading(false);
  showStatus(`${files.length} cifra(s) adicionada(s)!`);
};

// ================================
// IMPORTAÇÃO DO ONEDRIVE
// ================================
document.getElementById('open-cloud-folder').onclick = () => {
  window.open("https://1drv.ms/f/c/a71268bf66931c02/EpYyUsypAQhGgpWC9YuvE54BD_o9NX9tRar0piSzq4V4Xg", "_blank");
  showStatus('Abrindo pasta do OneDrive em uma nova aba.');
};

// ================================
// FULLSCREEN
// ================================
function openFullscreen(src, alt) {
  const overlay = document.createElement('div');
  overlay.className = 'fullscreen-image';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Visualização da imagem ${alt}`);
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  overlay.appendChild(img);
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ================================
// BOTÕES DE SELEÇÃO
// ================================
document.getElementById('select-all-btn').onclick = selectAll;
document.getElementById('clear-selection-btn').onclick = clearSelection;
document.getElementById('delete-selected-btn').onclick = deleteSelected;

// ================================
// INICIALIZAÇÃO
// ================================
document.addEventListener('DOMContentLoaded', async () => {
  tabs.forEach(tab => {
    if (!imageGalleryByTab.has(tab)) imageGalleryByTab.set(tab, []);
    if (!selectedImagesByTab.has(tab)) selectedImagesByTab.set(tab, new Set());
  });
  await loadLocalState();
});
