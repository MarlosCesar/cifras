// VARIÁVEIS GLOBAIS PARA O MODO DE SELEÇÃO E DRAG
    const tabs = ["Domingo Manhã", "Domingo Noite", "Segunda", "Quarta", "Culto Jovem", "Santa Ceia", "Outros"];
    let imageGalleryByTab = new Map();
    let selectedImagesByTab = new Map();
    let currentTab = tabs[0];
    window.isSelectionMode = false;
    window.longPressUsed = false;
    window.dragStartIndex = null;

    // IndexedDB helpers
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

    // Utils
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
    function saveAppState() {
      const imagesObj = {};
      tabs.forEach(tab => imagesObj[tab] = imageGalleryByTab.get(tab));
      const selectedObj = {};
      tabs.forEach(tab => selectedObj[tab] = Array.from(selectedImagesByTab.get(tab)));
      IndexedDB.saveState({ imagesObj, selectedObj, currentTab });
    }
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

    // Renderização de abas
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
          saveAppState();
        };
        tabsContainer.appendChild(btn);
      });
    }

    // Função moderna de criação de elementos de cifra com seleção e drag
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

    // Renderização das imagens usando createImageElement
    async function renderImages() {
      const list = document.getElementById('image-list');
      list.innerHTML = "";
      const names = imageGalleryByTab.get(currentTab) || [];
      if (!names.length) {
        list.innerHTML = `<p class="text-center text-gray-500 py-8">Nenhuma cifra selecionada.</p>`;
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

    // Drag & drop container listeners
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
      saveAppState();
    }

    // Seleção
    function toggleSelect(name, container) {
      const set = selectedImagesByTab.get(currentTab);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      renderImages();
      saveAppState();
      showSelectedPopup(set.size);
    }
    function clearSelection() {
      selectedImagesByTab.get(currentTab).clear();
      renderImages();
      saveAppState();
      showSelectedPopup(0);
    }
    function selectAll() {
      const set = selectedImagesByTab.get(currentTab);
      const names = imageGalleryByTab.get(currentTab) || [];
      names.forEach(name => set.add(name));
      renderImages();
      saveAppState();
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
          saveAppState();
          showStatus("Cifras excluídas!");
          showSelectedPopup(0);
        })
        .finally(() => showLoading(false));
    }

    // Controles de seleção dinâmicos
    function updateSelectionControls() {
      const set = selectedImagesByTab.get(currentTab);
      const total = (imageGalleryByTab.get(currentTab) || []).length;
      const selectionControls = document.getElementById('selection-controls');
      const selectAllBtn = document.getElementById('select-all-btn');
      selectionControls.style.display = set.size > 0 ? "flex" : "none";
      selectAllBtn.style.display = (total > 1 && set.size < total) ? "inline-flex" : "none";
    }

    // Importação local
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
      saveAppState();
      showLoading(false);
      showStatus(`${files.length} cifra(s) adicionada(s)!`);
    };

    // Importação do OneDrive (abrir em nova aba)
    document.getElementById('open-cloud-folder').onclick = () => {
      window.open("https://1drv.ms/f/c/a71268bf66931c02/EpYyUsypAQhGgpWC9YuvE54BD_o9NX9tRar0piSzq4V4Xg", "_blank");
      showStatus('Abrindo pasta do OneDrive em uma nova aba.');
    };

    // Fullscreen
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

    // Botões de seleção
    document.getElementById('select-all-btn').onclick = selectAll;
    document.getElementById('clear-selection-btn').onclick = clearSelection;
    document.getElementById('delete-selected-btn').onclick = deleteSelected;

    // Inicialização
    (async function() {
      showLoading(true);
      const state = await IndexedDB.loadState();
      restoreAppState(state);
      renderTabs();
      await renderImages();
      showLoading(false);
    })();
// MINHA ALTERAÇÃO COMEÇA AQUI
// Abas padrão fixas
const defaultTabs = [
  { id: 'domingo_manha', name: 'Domingo Manhã', removable: false },
  { id: 'domingo_noite', name: 'Domingo Noite', removable: false },
  { id: 'segunda', name: 'Segunda', removable: false },
  { id: 'quarta', name: 'Quarta', removable: false },
  { id: 'culto_jovem', name: 'Culto Jovem', removable: false }
];

function loadState() {
  let userTabs = [];
  let cifrasByTab = {};
  let selectedTab = defaultTabs[0].id;
  try {
    userTabs = JSON.parse(localStorage.getItem('userTabs')) || [];
    cifrasByTab = JSON.parse(localStorage.getItem('cifrasByTab')) || {};
    selectedTab = localStorage.getItem('selectedTab') || defaultTabs[0].id;
  } catch (e) {}
  // Garante que todas as abas padrão têm entry
  [...defaultTabs, ...userTabs].forEach(tab => {
    if (!cifrasByTab[tab.id]) cifrasByTab[tab.id] = [];
  });
  return { userTabs, cifrasByTab, selectedTab };
}

function saveState() {
  localStorage.setItem('userTabs', JSON.stringify(userTabs));
  localStorage.setItem('cifrasByTab', JSON.stringify(cifrasByTab));
  localStorage.setItem('selectedTab', selectedTab);
}

let { userTabs, cifrasByTab, selectedTab } = loadState();

function renderTabs() {
  const tabsList = document.getElementById('tabs-list');
  tabsList.innerHTML = '';

  // Render abas padrão
  defaultTabs.forEach(tab => {
    const li = document.createElement('li');
    li.className = 'tab' + (selectedTab === tab.id ? ' selected' : '');
    li.textContent = tab.name;
    li.dataset.id = tab.id;
    li.onclick = () => selectTab(tab.id);
    tabsList.appendChild(li);
  });

  // Render abas do usuário
  userTabs.forEach(tab => {
    const li = document.createElement('li');
    li.className = 'tab user-tab' + (selectedTab === tab.id ? ' selected' : '');
    li.textContent = tab.name;
    li.dataset.id = tab.id;

    // botão X para remover (visível em modo show-close)
    const closeBtn = document.createElement('span');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✖';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      removeTab(tab.id);
    };
    li.appendChild(closeBtn);

    // Pressionar e segurar para mostrar X (só some se clicar);
    let pressTimer = null;
    li.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      pressTimer = setTimeout(() => {
        li.classList.add('show-close');
      }, 350);
    });
    li.addEventListener('mouseup', (ev) => {
      clearTimeout(pressTimer);
    });
    li.addEventListener('click', () => {
      if (li.classList.contains('show-close')) {
        li.classList.remove('show-close');
      } else {
        selectTab(tab.id);
      }
    });

    tabsList.appendChild(li);
  });

  // Botão "+"
  const addBtn = document.createElement('li');
  addBtn.className = 'tab add-tab';
  addBtn.textContent = '+';
  addBtn.onclick = openPopup;
  tabsList.appendChild(addBtn);

  saveState();
  renderCifras();
}

function selectTab(id) {
  selectedTab = id;
  saveState();
  renderTabs();
}

// Popup lógica
function openPopup() {
  document.getElementById('popup-bg').style.display = 'flex';
  document.getElementById('tabName').value = '';
  setTimeout(() => document.getElementById('tabName').focus(), 100);
}
function closePopup() {
  document.getElementById('popup-bg').style.display = 'none';
}
function addTab() {
  const name = document.getElementById('tabName').value.trim();
  if (!name) return;
  const id = 'user_' + Date.now();
  userTabs.push({ id, name });
  cifrasByTab[id] = [];
  selectedTab = id;
  saveState();
  renderTabs();
  closePopup();
}
function removeTab(id) {
  userTabs = userTabs.filter(tab => tab.id !== id);
  delete cifrasByTab[id];
  if (selectedTab === id) selectedTab = defaultTabs[0].id;
  saveState();
  renderTabs();
}

// Eventos popup
document.getElementById('addTabBtn').onclick = addTab;
document.getElementById('cancelTabBtn').onclick = closePopup;
document.getElementById('tabName').onkeydown = (e) => {
  if (e.key === 'Enter') addTab();
  if (e.key === 'Escape') closePopup();
};

// ---------------- CIFRAS POR ABA -------------------

function renderCifras() {
  const imageList = document.getElementById('image-list');
  imageList.innerHTML = '';
  let cifras = cifrasByTab[selectedTab] || [];
  if (!cifras || cifras.length === 0) {
    const p = document.createElement('p');
    p.className = "text-center text-gray-500 py-8";
    p.textContent = "Nenhuma cifra nesta aba.";
    imageList.appendChild(p);
  } else {
    cifras.forEach((cifra, idx) => {
      const item = document.createElement('div');
      item.className = "bg-gray-100 p-4 rounded flex items-center justify-between";
      item.innerHTML = `<span>${cifra}</span>
        <button class="text-red-600 hover:text-red-800" title="Remover" aria-label="Remover" onclick="removeCifra('${selectedTab}', ${idx})"><i class="fas fa-trash-alt"></i></button>`;
      imageList.appendChild(item);
    });
  }
  saveState();
}

// Adiciona cifra para a aba selecionada
window.addCifraToCurrentTab = function(cifraName) {
  if (!cifraName) return;
  if (!cifrasByTab[selectedTab]) cifrasByTab[selectedTab] = [];
  cifrasByTab[selectedTab].push(cifraName);
  renderCifras();
};
// Remove cifra
window.removeCifra = function(tabId, idx) {
  if (!cifrasByTab[tabId]) return;
  cifrasByTab[tabId].splice(idx, 1);
  renderCifras();
};

// Inicialização
renderTabs();
