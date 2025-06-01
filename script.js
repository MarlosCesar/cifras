// ================================
// CONFIGURAÇÃO FIREBASE (SUBSTITUA PELOS SEUS DADOS!)
// ================================
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_DOMINIO.firebaseapp.com",
  projectId: "SEU_PROJECT_ID",
  storageBucket: "SEU_BUCKET.appspot.com",
  messagingSenderId: "SEU_MESSAGING_ID",
  appId: "SEU_APP_ID"
};

// ================================
// INICIALIZAÇÃO GLOBAL
// ================================
let onlineMode = false; // false = local, true = firebase
let firebaseApp = null;
let firestore = null;

const ONLINE_COLLECTION = "cifras-selecionadas"; // Nome da coleção no Firestore
const ONLINE_DOC = "unico"; // Você pode mudar para por categoria, se quiser

// ================================
// IndexedDB helpers (inalterado)
// ================================
const DB_NAME = 'CifrasDB', DB_VERSION = 1, STORE_IMAGES = 'images', STORE_STATE = 'state';
const IndexedDB = {
  db:null, open:()=>new Promise((res,rej)=>{
    if(IndexedDB.db) return res(IndexedDB.db);
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains(STORE_IMAGES))db.createObjectStore(STORE_IMAGES,{keyPath:'key'});
      if(!db.objectStoreNames.contains(STORE_STATE))db.createObjectStore(STORE_STATE,{keyPath:'key'});
    };
    r.onsuccess=e=>{IndexedDB.db=e.target.result;res(IndexedDB.db);};
    r.onerror=e=>rej(e.target.error);
  }),
  putImage:(key,blob)=>IndexedDB.open().then(db=>new Promise((res,rej)=>{
    const tx=db.transaction([STORE_IMAGES],'readwrite');
    tx.objectStore(STORE_IMAGES).put({key,blob});
    tx.oncomplete=res; tx.onerror=e=>rej(e.target.error);
  })),
  getImage:key=>IndexedDB.open().then(db=>new Promise((res,rej)=>{
    const tx=db.transaction([STORE_IMAGES],'readonly');
    const req=tx.objectStore(STORE_IMAGES).get(key);
    req.onsuccess=()=>res(req.result?req.result.blob:null);
    req.onerror=e=>rej(e.target.error);
  })),
  deleteImage:key=>IndexedDB.open().then(db=>new Promise((res,rej)=>{
    const tx=db.transaction([STORE_IMAGES],'readwrite');
    tx.objectStore(STORE_IMAGES).delete(key);
    tx.oncomplete=res; tx.onerror=e=>rej(e.target.error);
  })),
  saveState:state=>IndexedDB.open().then(db=>new Promise((res,rej)=>{
    const tx=db.transaction([STORE_STATE],'readwrite');
    tx.objectStore(STORE_STATE).put({key:"state",...state});
    tx.oncomplete=res; tx.onerror=e=>rej(e.target.error);
  })),
  loadState:()=>IndexedDB.open().then(db=>new Promise((res,rej)=>{
    const tx=db.transaction([STORE_STATE],'readonly');
    const req=tx.objectStore(STORE_STATE).get("state");
    req.onsuccess=()=>res(req.result||null);
    req.onerror=e=>rej(e.target.error);
  }))
};

// ================================
// VARIÁVEIS GLOBAIS
// ================================
const tabs = ["Domingo Manhã", "Domingo Noite", "Segunda", "Quarta", "Culto Jovem", "Santa Ceia", "Outros"];
let imageGalleryByTab = new Map();
let selectedImagesByTab = new Map();
let currentTab = tabs[0];
window.isSelectionMode = false;
window.longPressUsed = false;
window.dragStartIndex = null;

// ================================
// HELPERS DE UI (SEM ALTERAÇÕES)
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
function showSelectedPopup(count) {
  const el = document.getElementById('selected-popup');
  if (count > 0) {
    el.textContent = `${count} selecionada${count > 1 ? "s" : ""}`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
    el.textContent = "";
  }
}

// ================================
// SWITCH Online/Off-line
// ================================
const onlineSwitch = document.getElementById('online-switch');
const onlineStatusLabel = document.getElementById('online-status-label');

function setOnlineMode(active) {
  onlineMode = active;
  if (onlineMode) {
    onlineStatusLabel.textContent = "Online";
    onlineStatusLabel.classList.remove("text-gray-700");
    onlineStatusLabel.classList.add("text-blue-600");
    initFirebase();
    loadOnlineState();
  } else {
    onlineStatusLabel.textContent = "Off-line";
    onlineStatusLabel.classList.remove("text-blue-600");
    onlineStatusLabel.classList.add("text-gray-700");
    loadLocalState();
  }
}

// Inicialização do Switch
onlineSwitch.addEventListener('change', function() {
  setOnlineMode(this.checked);
});

// Estado inicial
setOnlineMode(false);

// ================================
// FIREBASE - INICIALIZAÇÃO E FUNÇÕES CRUD
// ================================
function initFirebase() {
  if (!firebaseApp) {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    firestore = firebase.firestore();
  }
}

// Salvar estado no Firestore
async function saveOnlineState() {
  if (!firestore) return;
  const imagesObj = {};
  tabs.forEach(tab => imagesObj[tab] = imageGalleryByTab.get(tab));
  const selectedObj = {};
  tabs.forEach(tab => selectedObj[tab] = Array.from(selectedImagesByTab.get(tab)));
  await firestore.collection(ONLINE_COLLECTION).doc(ONLINE_DOC).set({
    imagesObj, selectedObj, currentTab
  });
}

// Carregar estado do Firestore
async function loadOnlineState() {
  showLoading(true);
  if (!firestore) initFirebase();
  const doc = await firestore.collection(ONLINE_COLLECTION).doc(ONLINE_DOC).get();
  if (doc.exists) {
    const state = doc.data();
    restoreAppState(state);
    renderTabs();
    await renderImages();
  } else {
    tabs.forEach(tab => {
      imageGalleryByTab.set(tab, []);
      selectedImagesByTab.set(tab, new Set());
    });
    renderTabs();
    await renderImages();
  }
  showLoading(false);
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
// RESTAURAÇÃO DE ESTADO (COMUM)
// ================================
function restoreAppState(state) {
  if (!state) {
    tabs.forEach(tab => {
      imageGalleryByTab.set(tab, []);
      selectedImagesByTab.set(tab, new Set());
    });
    return;
  }
  tabs.forEach(tab => {
    imageGalleryByTab.set(tab, state.imagesObj[tab] || []);
    selectedImagesByTab.set(tab, new Set(state.selectedObj[tab] || []));
  });
  currentTab = state.currentTab || tabs[0];
}

// ================================
// RENDERIZAÇÃO DE ABAS (SEM ALTERAÇÃO)
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
      if (onlineMode) saveOnlineState();
      else saveLocalState();
    };
    tabsContainer.appendChild(btn);
  });
}

// ================================
// IMAGENS E SELEÇÃO (INALTERADO, MAS SALVA NO MODO CORRETO!)
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
  checkbox.onclick = e => { e.stopPropagation(); toggleSelect(imageName, container); };
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

  // --- Eventos para seleção e drag ---
  let longPressTimeout = null;
  let dragActivated = false;
  let isDragging = false;

  // Mobile: long-press para seleção ou drag
  container.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) return;
    dragActivated = false;
    isDragging = false;
    longPressTimeout = setTimeout(() => {
      if (!window.longPressUsed) {
        window.isSelectionMode = true;
        window.longPressUsed = true;
        toggleSelect(imageName, container);
      } else {
        dragActivated = true;
        isDragging = true;
        container.classList.add('dragging');
        window.dragStartIndex = Array.from(document.getElementById('image-list').children).indexOf(container);
      }
    }, 400);
  }, {passive: true});

  container.addEventListener('touchmove', function(e) {
    if (dragActivated && isDragging && e.touches.length === 1) {
      // efeito visual opcional
    } else {
      clearTimeout(longPressTimeout);
    }
  }, {passive: true});

  container.addEventListener('touchend', function(e) {
    clearTimeout(longPressTimeout);
    if (dragActivated && isDragging) {
      container.classList.remove('dragging');
      // Encontrar destino
      const containers = Array.from(document.getElementById('image-list').children);
      let toIndex = containers.indexOf(document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY));
      if (toIndex === -1) toIndex = containers.length - 1;
      reorderImages(window.dragStartIndex, toIndex);
      // Limpa seleção após drag
      selectedImagesByTab.get(currentTab).clear();
      window.isSelectionMode = false;
      window.longPressUsed = false;
      renderImages();
    } else if (!window.isSelectionMode && !window.longPressUsed) {
      openFullscreen(objectURL, imageName);
    } else if (window.isSelectionMode && window.longPressUsed) {
      toggleSelect(imageName, container);
    }
  }, {passive: true});

  // Desktop: long-press com mouse para seleção ou drag
  container.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    dragActivated = false;
    isDragging = false;
    longPressTimeout = setTimeout(() => {
      if (!window.longPressUsed) {
        window.isSelectionMode = true;
        window.longPressUsed = true;
        toggleSelect(imageName, container);
      } else {
        dragActivated = true;
        isDragging = true;
        container.classList.add('dragging');
        window.dragStartIndex = Array.from(document.getElementById('image-list').children).indexOf(container);
      }
    }, 400);
  });
  container.addEventListener('mousemove', function() {
    clearTimeout(longPressTimeout);
  });
  container.addEventListener('mouseup', function(e) {
    clearTimeout(longPressTimeout);
    if (dragActivated && isDragging) {
      container.classList.remove('dragging');
      const containers = Array.from(document.getElementById('image-list').children);
      let toIndex = containers.indexOf(document.elementFromPoint(e.clientX, e.clientY));
      if (toIndex === -1) toIndex = containers.length - 1;
      reorderImages(window.dragStartIndex, toIndex);
      selectedImagesByTab.get(currentTab).clear();
      window.isSelectionMode = false;
      window.longPressUsed = false;
      renderImages();
    } else if (!window.isSelectionMode && !window.longPressUsed) {
      openFullscreen(objectURL, imageName);
    } else if (window.isSelectionMode && window.longPressUsed) {
      toggleSelect(imageName, container);
    }
  });
  container.addEventListener('mouseleave', function() {
    clearTimeout(longPressTimeout);
  });

  // Drag & drop HTML5 para desktop
  container.addEventListener('dragstart', function(e) {
    if (!window.isSelectionMode) {
      window.isSelectionMode = true;
      window.longPressUsed = true;
      toggleSelect(imageName, container);
    }
    container.classList.add('dragging');
    window.dragStartIndex = Array.from(document.getElementById('image-list').children).indexOf(container);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', imageName);
  });

  return container;
}

// ================================
// RENDERIZAÇÃO DAS IMAGENS (QUANDO SEM IMAGENS, TEXTO ALTERADO!)
// ================================
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

// ================================
// DRAG & DROP CONTAINER LISTENERS
// ================================
document.getElementById('image-list').addEventListener('dragover', function(e) {
  e.preventDefault();
  const dragging = document.querySelector('.dragging');
  if (!dragging) return;
  const after = getDragAfterElement(this, e.clientY);
  this.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (after) after.classList.add('drag-over');
});
document.getElementById('image-list').addEventListener('drop', function(e) {
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
  window.isSelectionMode = false;
  window.longPressUsed = false;
  renderImages();
});
function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('.image-container:not(.dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return {offset, element: child};
    else return closest;
  }, {offset: -Infinity, element: null}).element;
}
function reorderImages(fromIndex, toIndex) {
  const arr = imageGalleryByTab.get(currentTab) || [];
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  const [item] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, item);
  imageGalleryByTab.set(currentTab, arr);
  if (onlineMode) saveOnlineState();
  else saveLocalState();
}

// ================================
// SELEÇÃO
// ================================
function toggleSelect(name, container) {
  const set = selectedImagesByTab.get(currentTab);
  if (set.has(name)) set.delete(name);
  else set.add(name);
  renderImages();
  if (onlineMode) saveOnlineState();
  else saveLocalState();
  showSelectedPopup(set.size);
}
function clearSelection() {
  selectedImagesByTab.get(currentTab).clear();
  renderImages();
  if (onlineMode) saveOnlineState();
  else saveLocalState();
  showSelectedPopup(0);
}
function selectAll() {
  const set = selectedImagesByTab.get(currentTab);
  const names = imageGalleryByTab.get(currentTab) || [];
  names.forEach(name => set.add(name));
  renderImages();
  if (onlineMode) saveOnlineState();
  else saveLocalState();
  showSelectedPopup(set.size);
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
      if (onlineMode) saveOnlineState();
      else saveLocalState();
      showStatus("Cifras excluídas!");
      showSelectedPopup(0);
    })
    .finally(() => showLoading(false));
}

// ================================
// CONTROLES DE SELEÇÃO DINÂMICOS
// ================================
function updateSelectionControls() {
  const set = selectedImagesByTab.get(currentTab);
  const total = (imageGalleryByTab.get(currentTab) || []).length;
  const selectionControls = document.getElementById('selection-controls');
  const selectAllBtn = document.getElementById('select-all-btn');
  selectionControls.style.display = set.size > 0 ? "flex" : "none";
  selectAllBtn.style.display = (total > 1 && set.size < total) ? "inline-flex" : "none";
}

// ================================
// IMPORTAÇÃO LOCAL
// ================================
document.getElementById('open-file-dialog').onclick = () => {
  document.getElementById('file-input').click();
};
document.getElementById('file-input').onchange = async function(e) {
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
  if (onlineMode) saveOnlineState();
  else saveLocalState();
  showLoading(false);
  showStatus(`${files.length} cifra(s) adicionada(s)!`);
};

// ================================
// IMPORTAÇÃO DO ONEDRIVE (INALTERADO)
// ================================
document.getElementById('open-cloud-folder').onclick = () => {
  window.open("https://1drv.ms/f/c/a71268bf66931c02/EpYyUsypAQhGgpWC9YuvE54BD_o9NX9tRar0piSzq4V4Xg", "_blank");
  showStatus('Abrindo pasta do OneDrive em uma nova aba.');
};

// ================================
// FULLSCREEN (INALTERADO)
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
  overlay.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    overlay.remove();
  };
  document.body.appendChild(overlay);
  if (overlay.requestFullscreen) overlay.requestFullscreen();
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
(async function() {
  // O modo inicial é controlado pelo switch, que chama setOnlineMode()
  // Nada aqui!
})();