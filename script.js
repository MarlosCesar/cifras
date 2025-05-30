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
  darkMode: false // Adicionado: estado do modo noturno
};

// ================ INICIALIZAÇÃO ================
document.addEventListener('DOMContentLoaded', async () => {
  await initializeDB();
  loadState();
  setupEventListeners();
  renderTabs();
  renderCifras();
  applyDarkMode(); // Adicionado: aplica o modo noturno salvo
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
        case 'get':
          req = store.get(data.key);
          break;
        case 'getAll':
          req = store.getAll();
          break;
        case 'put':
          req = store.put(data);
          break;
        case 'delete':
          req = store.delete(data.key);
          break;
        default:
          reject(new Error('Operação inválida'));
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
      appState.darkMode = savedState.darkMode === true; // Carrega o estado do modo noturno
      
      // Inicializa todas as abas no mapa de seleção
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
    darkMode: appState.darkMode // Salva o estado do modo noturno
  };
  
  localStorage.setItem('cifrasAppState', JSON.stringify(stateToSave));
  
  // Salva também no IndexedDB para imagens grandes
  dbOperation(DB_CONFIG.stores.state, 'put', {
    key: 'appState',
    ...stateToSave
  }).catch(console.error);
}

function getAllTabIds() {
  return [...DEFAULT_TABS, ...appState.userTabs].map(tab => tab.id);
}

// ================ RENDERIZAÇÃO ================
function renderTabs() {
  const tabsList = document.getElementById('tabs-list');
  tabsList.innerHTML = '';
  
  // Render abas padrão
  DEFAULT_TABS.forEach(tab => {
    tabsList.appendChild(createTabElement(tab));
  });
  
  // Render abas do usuário
  appState.userTabs.forEach(tab => {
    tabsList.appendChild(createTabElement(tab, true));
  });
  
  // Botão para adicionar nova aba
  const addBtn = document.createElement('li');
  addBtn.className = 'tab add-tab';
  addBtn.innerHTML = '<span aria-hidden="true">+</span><span class="sr-only">Adicionar nova categoria</span>';
  addBtn.onclick = showAddTabDialog;
  tabsList.appendChild(addBtn);
  
  // Atualiza controles de seleção
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
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      removeTab(tab.id);
    };
    li.appendChild(closeBtn);
  }
  
  li.onclick = () => selectTab(tab.id);
  
  return li;
}

function renderCifras() {
  const imageList = document.getElementById('image-list');
  imageList.innerHTML = '';
  
  const currentTabId = appState.selectedTab;
  const cifras = appState.cifrasByTab[currentTabId] || [];
  
  if (cifras.length === 0) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'Nenhuma cifra nesta aba.';
    imageList.appendChild(emptyState);
    return;
  }
  
  cifras.forEach((cifra, index) => {
    const isSelected = appState.selectedImages.get(currentTabId).has(index);
    const cifraElement = createCifraElement(cifra, index, isSelected);
    imageList.appendChild(cifraElement);
  });
}

function createCifraElement(cifra, index, isSelected = false) {
  const container = document.createElement('div');
  container.className = `cifra-thumb ${isSelected ? 'selected' : ''}`;
  container.dataset.index = index;
  container.setAttribute('role', 'checkbox');
  container.setAttribute('aria-checked', isSelected);
  container.tabIndex = 0;
  
  // Carrega a imagem do IndexedDB
  loadCifraImage(cifra).then(imgUrl => {
    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = cifra.name || `Cifra ${index + 1}`;
    container.appendChild(img);
  }).catch(console.error);
  
  const nameSpan = document.createElement('span');
  nameSpan.textContent = cifra.name || cifra.replace(/\.[^/.]+$/, '');
  container.appendChild(nameSpan);
  
  // Eventos de interação
  setupCifraInteractions(container, index);
  
  return container;
}

async function loadCifraImage(cifra) {
  if (typeof cifra === 'string') {
    const blob = await dbOperation(DB_CONFIG.stores.images, 'get', { key: `${appState.selectedTab}:${cifra}` });
    return blob ? URL.createObjectURL(blob) : '';
  }
  return URL.createObjectURL(cifra);
}

function setupCifraInteractions(element, index) {
  let pressTimer = null;
  const currentTabId = appState.selectedTab;
  
  // Desktop
  element.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    
    pressTimer = setTimeout(() => {
      appState.isSelectionMode = true;
      toggleSelectCifra(currentTabId, index, element);
    }, 500);
  });
  
  element.addEventListener('mouseup', () => {
    clearTimeout(pressTimer);
    if (!appState.isSelectionMode) {
      openFullscreenView(element.querySelector('img').src, element.textContent);
    }
  });
  
  element.addEventListener('mouseleave', () => clearTimeout(pressTimer));
  
  // Mobile
  element.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) return;
    
    pressTimer = setTimeout(() => {
      appState.isSelectionMode = true;
      toggleSelectCifra(currentTabId, index, element);
    }, 500);
  }, { passive: true });
  
  element.addEventListener('touchend', () => {
    clearTimeout(pressTimer);
    if (!appState.isSelectionMode) {
      openFullscreenView(element.querySelector('img').src, element.textContent);
    }
  }, { passive: true });
  
  // Keyboard
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
  const dialog = document.getElementById('popup-bg');
  dialog.hidden = false;
  document.getElementById('tabName').value = '';
  document.getElementById('tabName').focus();
}

function closeAddTabDialog() {
  document.getElementById('popup-bg').hidden = true;
}

function addTab() {
  const nameInput = document.getElementById('tabName');
  const name = nameInput.value.trim();
  
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
  
  // Remove do estado
  appState.userTabs = appState.userTabs.filter(tab => tab.id !== tabId);
  delete appState.cifrasByTab[tabId];
  appState.selectedImages.delete(tabId);
  
  // Se estava na aba removida, volta para a primeira aba
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
    // Remove do IndexedDB
    const deletePromises = Array.from(selectedSet).map(index => {
      const cifra = cifras[index];
      if (typeof cifra === 'string') {
        return dbOperation(DB_CONFIG.stores.images, 'delete', { key: `${currentTabId}:${cifra}` });
      }
      return Promise.resolve();
    });
    
    await Promise.all(deletePromises);
    
    // Atualiza o estado
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
  const fileInput = document.getElementById('file-input');
  
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    showLoading(true);
    
    try {
      const currentTabId = appState.selectedTab;
      const cifras = appState.cifrasByTab[currentTabId] || [];
      
      for (const file of files) {
        const existingIndex = cifras.findIndex(c => 
          typeof c === 'string' ? c === file.name : c.name === file.name
        );
        
        if (existingIndex === -1) {
          // Salva no IndexedDB
          await dbOperation(DB_CONFIG.stores.images, 'put', {
            key: `${currentTabId}:${file.name}`,
            blob: file
          });
          
          // Adiciona ao estado
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
      fileInput.value = ''; // Permite re-selecionar os mesmos arquivos
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
  const body = document.body;
  const nightModeIcon = document.getElementById('night-mode-icon');
  
  if (appState.darkMode) {
    body.classList.add('dark-mode');
    nightModeIcon.classList.remove('fa-moon');
    nightModeIcon.classList.add('fa-sun');
  } else {
    body.classList.remove('dark-mode');
    nightModeIcon.classList.remove('fa-sun');
    nightModeIcon.classList.add('fa-moon');
  }
}

// ================ UI HELPERS ================
function showLoading(show) {
  const spinner = document.getElementById('loading-spinner');
  spinner.hidden = !show;
}

function showStatus(message) {
  const statusElement = document.getElementById('status-message');
  statusElement.textContent = message;
  statusElement.hidden = false;
  
  setTimeout(() => {
    statusElement.hidden = true;
  }, 3000);
}

function showSelectedCount(count) {
  const popup = document.getElementById('selected-popup');
  
  if (count > 0) {
    popup.textContent = `${count} selecionada${count > 1 ? 's' : ''}`;
    popup.hidden = false;
  } else {
    popup.hidden = true;
  }
}

function updateSelectionControls() {
  const currentTabId = appState.selectedTab;
  const selectedCount = appState.selectedImages.get(currentTabId).size;
  const totalCount = appState.cifrasByTab[currentTabId]?.length || 0;
  
  const controls = document.getElementById('selection-controls');
  const selectAllBtn = document.getElementById('select-all-btn');
  const clearBtn = document.getElementById('clear-selection-btn');
  const deleteBtn = document.getElementById('delete-selected-btn');
  
  controls.hidden = selectedCount === 0;
  selectAllBtn.hidden = selectedCount === totalCount || totalCount === 0;
}

function openFullscreenView(imageSrc, imageName) {
  const overlay = document.createElement('div');
  overlay.className = 'fullscreen-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Visualizando: ${imageName}`);
  
  const img = document.createElement('img');
  img.src = imageSrc;
  img.alt = imageName;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-fullscreen';
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.setAttribute('aria-label', 'Fechar visualização');
  
  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
  
  // Fechar ao clicar no overlay ou botão
  const close = () => {
    document.body.removeChild(overlay);
    URL.revokeObjectURL(imageSrc); // Libera memória
  };
  
  overlay.onclick = (e) => {
    if (e.target === overlay || e.target === closeBtn || e.target.closest('.close-fullscreen')) {
      close();
    }
  };
  
  // Fechar com ESC
  document.addEventListener('keydown', function escListener(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escListener);
    }
  });
}

// ================ CONFIGURAÇÃO DE EVENTOS ================
function setupEventListeners() {
  // Botões de aba
  document.getElementById('addTabBtn').addEventListener('click', addTab);
  document.getElementById('cancelTabBtn').addEventListener('click', closeAddTabDialog);
  
  // Teclado no popup de nova aba
  document.getElementById('tabName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTab();
    if (e.key === 'Escape') closeAddTabDialog();
  });
  
  // Botões de seleção
  document.getElementById('select-all-btn').addEventListener('click', selectAllCifras);
  document.getElementById('clear-selection-btn').addEventListener('click', clearSelection);
  document.getElementById('delete-selected-btn').addEventListener('click', deleteSelectedCifras);
  
  // Importação de arquivos
  document.getElementById('open-file-dialog').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  
  setupFileInput();
  
  // OneDrive
  document.getElementById('open-cloud-folder').addEventListener('click', () => {
    window.open('https://1drv.ms/f/c/a71268bf66931c02/EpYyUsypAQhGgpWC9YuvE54BD_o9NX9tRar0piSzq4V4Xg', '_blank');
    showStatus('Abrindo pasta do OneDrive em uma nova aba');
  });
  
  // Modo Noturno (substitui a sincronização)
  const syncBtn = document.getElementById('sync-btn');
  syncBtn.addEventListener('click', toggleNightMode);
  syncBtn.setAttribute('title', 'Alternar Modo Noturno'); // Atualiza tooltip
  
  // Configurações
  document.getElementById('settings-btn').addEventListener('click', () => {
    showStatus('Configurações em desenvolvimento');
  });
}
