const DEFAULT_PLAYLIST = "Все треки";
let playlists = { [DEFAULT_PLAYLIST]: [] };
let activePlaylist = DEFAULT_PLAYLIST;
let currentTrackIndex = -1;
let isRepeat = false, isShuffle = false;
let searchQuery = "", editTarget = null, draggedIndex = null;
let bgUrl = null; // Для управления памятью фона

const audio = document.getElementById('audio-core');
const progress = document.getElementById('progress-slider');
const volumeSlider = document.getElementById('volume-slider');
const songList = document.getElementById('songs-container');
const dz = document.getElementById('drop-zone');
const dbName = "GrigMusicDB";
let db;

// --- ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ---
const request = indexedDB.open(dbName, 1);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
};

request.onsuccess = (e) => { 
    db = e.target.result; 
    loadData(); // Загрузка всех данных только после успешного открытия БД
};

request.onerror = (e) => {
    console.error("Ошибка открытия IndexedDB:", e.target.error);
    alert("Ошибка загрузки данных плеера. Возможно, ваше устройство не поддерживает IndexedDB.");
    render(); 
};

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (ОБЪЯВЛЕНЫ ДО ИСПОЛЬЗОВАНИЯ) ---

function formatTime(s) {
    const m = Math.floor(s / 60), sc = Math.floor(s % 60);
    return `${m}:${sc < 10 ? '0' : ''}${sc}`;
}

function updatePlayIcon(isPlay) {
    document.getElementById('svg-play').style.display = isPlay ? 'none' : 'block';
    document.getElementById('svg-pause').style.display = isPlay ? 'block' : 'none';
}

function savePlaylistStructure() {
    const keys = Object.keys(playlists).filter(k => k !== DEFAULT_PLAYLIST);
    localStorage.setItem('playlist_structure', JSON.stringify(keys));
}

function changeAccentColor(c) {
    document.documentElement.style.setProperty('--accent', c);
    localStorage.setItem('grig_accent_color', c);
    const picker = document.getElementById('accent-color-input');
    if (picker) picker.value = c;
}

function updateBackgroundUI(blobOrFile) {
    if (bgUrl) URL.revokeObjectURL(bgUrl); 
    bgUrl = URL.createObjectURL(blobOrFile); 
    document.getElementById('custom-bg').style.backgroundImage = `url(${bgUrl})`;
    document.getElementById('bg-preview-box').style.backgroundImage = `url(${bgUrl})`;
    document.getElementById('bg-plus-icon').style.display = 'none';
}

// --- ОСНОВНЫЕ ФУНКЦИИ ---

function loadData() {
    // 1. Восстанавливаем структуру плейлистов из localStorage
    const savedStructure = localStorage.getItem('playlist_structure');
    if (savedStructure) {
        try {
            JSON.parse(savedStructure).forEach(n => {
                if (n && n !== DEFAULT_PLAYLIST) playlists = []; // ИСПРАВЛЕНО
            });
        } catch(e) { console.error("Ошибка структуры плейлистов", e); }
    }

    // 2. Загружаем визуальные настройки (Функция уже определена выше)
    changeAccentColor(localStorage.getItem('grig_accent_color') || 'rgb(180, 180, 180)');
    const savedVol = localStorage.getItem('grig_volume');
    if (savedVol !== null) { 
        audio.volume = parseFloat(savedVol); 
        volumeSlider.value = Math.sqrt(audio.volume) * 100; 
    }

    // 3. Загружаем фон из БД (с защитой if(db))
    if (db) {
        db.transaction(['settings'], 'readonly').objectStore('settings').get('background').onsuccess = (e) => {
            if (e.target.result) updateBackgroundUI(e.target.result);
        };
    }

    // 4. ЗАГРУЗКА ТРЕКОВ ИЗ БД
    if (db) {
        const store = db.transaction(['songs'], 'readonly').objectStore('songs');
        store.getAll().onsuccess = (e) => {
            const allSongs = e.target.result || [];
            Object.keys(playlists).forEach(key => playlists[key] = []); // Очищаем текущие массивы
            
            allSongs.forEach(track => {
                track.url = URL.createObjectURL(track.file); 
                if (track.coverBlob) track.cover = URL.createObjectURL(track.coverBlob);
                if (playlists[track.playlist]) {
                    playlists[track.playlist].push(track);
                } else {
                    track.playlist = DEFAULT_PLAYLIST;
                    playlists[DEFAULT_PLAYLIST].push(track);
                }
            });

            // Восстановление состояния плеера 
            const savedTrackIndex = localStorage.getItem('currentTrackIndex');
            const savedPlaylistName = localStorage.getItem('activePlaylistName');

            if (savedPlaylistName && playlists[savedPlaylistName]) {
                activePlaylist = savedPlaylistName;
                const idx = parseInt(savedTrackIndex);
                if (!isNaN(idx) && idx >= 0 && playlists[activePlaylist][idx]) {
                    playTrack(idx, true); 
                    audio.pause();
                    updatePlayIcon(false);
                }
            }
            render(); // Отрисовываем всё, когда данные готовы
        };
    }
}


function render() {
    const pList = document.getElementById('playlist-list');
    if (pList) {
        pList.innerHTML = '';
        Object.keys(playlists).forEach(name => {
            const el = document.createElement('div');
            el.className = `item ${name === activePlaylist ? 'active' : ''}`;
            el.textContent = `${name} (${playlists[name]?.length || 0})`;
            el.onclick = () => { activePlaylist = name; currentTrackIndex = -1; localStorage.setItem('activePlaylistName', name); render(); };
            if (name !== DEFAULT_PLAYLIST) el.ondblclick = () => openEditModal('playlist', name);
            pList.appendChild(el);
        });
    }

    if (!songList) return;
    songList.innerHTML = '';
    document.getElementById('current-playlist-name').textContent = `Плейлист: ${activePlaylist}`;

    const list = playlists[activePlaylist] || [];
    list.forEach((track, index) => {
        if (searchQuery && !track.name.toLowerCase().includes(searchQuery)) return;
        
        const el = document.createElement('div');
        el.className = `item ${index === currentTrackIndex ? 'active' : ''}`;
        el.setAttribute('draggable', 'true');
        el.innerHTML = `
            <img src="${track.cover || 'images/logo.png'}" class="track-mini-cover">
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${track.name}</span>
            <span onclick="deleteTrack(event, ${index})" style="opacity:0.3; padding:5px; cursor:pointer;">✕</span>
        `;
        el.onclick = () => playTrack(index);
        el.ondblclick = (e) => { e.stopPropagation(); openEditModal('track', track.name, index); };
        
        el.ondragstart = () => { draggedIndex = index; };
        el.ondragover = (e) => e.preventDefault();
        el.ondrop = () => {
            if (draggedIndex === null || draggedIndex === index) return;
            const currentList = playlists[activePlaylist];
            const [movedItem] = currentList.splice(draggedIndex, 1); 
            currentList.splice(index, 0, movedItem);
            render();
        };
        songList.appendChild(el);
    });
}

function playTrack(idx, preventAutoPlay = false) {
    const list = playlists[activePlaylist];
    if (!list || !list[idx]) return;
    const track = list[idx];
    currentTrackIndex = idx;
    audio.src = track.url;
    document.getElementById('current-track-title').textContent = track.name;
    document.getElementById('main-cover').src = track.cover || 'images/logo.png'; 
    
    if (!preventAutoPlay) {
        audio.play().catch(e => console.warn("Автоплей заблокирован браузером:", e));
        updatePlayIcon(true);
    }
    render();
    localStorage.setItem('currentTrackIndex', idx);
    localStorage.setItem('activePlaylistName', activePlaylist);
}

// --- ОБРАБОТЧИКИ СОБЫТИЙ AUDIO И КНОПОК ---

function togglePlay() {
    if (!audio.src || audio.src.includes('null')) return;
    audio.paused ? audio.play() : audio.pause();
    updatePlayIcon(!audio.paused);
}

function nextTrack() {
    const list = playlists[activePlaylist];
    if (!list || list.length === 0) return;
    if (isShuffle) {
        currentTrackIndex = Math.floor(Math.random() * list.length);
    } else {
        currentTrackIndex = (currentTrackIndex + 1) % list.length;
    }
    playTrack(currentTrackIndex);
}

function prevTrack() {
    const list = playlists[activePlaylist];
    if (!list || list.length === 0) return;
    currentTrackIndex = (currentTrackIndex - 1 < 0) ? list.length - 1 : currentTrackIndex - 1;
    playTrack(currentTrackIndex);
}

audio.onended = () => isRepeat ? audio.play() : nextTrack();
audio.ontimeupdate = () => {
    if (!audio.duration) return;
    progress.value = (audio.currentTime / audio.duration) * 100;
    document.getElementById('time-current').textContent = formatTime(audio.currentTime);
};
audio.onloadedmetadata = () => document.getElementById('time-total').textContent = formatTime(audio.duration);
progress.oninput = () => audio.currentTime = (progress.value / 100) * audio.duration;

volumeSlider.oninput = () => {
    const val = volumeSlider.value / 100;
    audio.volume = val * val; 
    localStorage.setItem('grig_volume', audio.volume);
};

// --- ФУНКЦИИ РАБОТЫ С ФАЙЛАМИ И БД ---

function handleFileUpload(files) {
    if (!db) { console.error("База данных не инициализирована!"); return; }
    const tx = db.transaction(['songs'], 'readwrite');
    const store = tx.objectStore('songs');
    Array.from(files).forEach(file => {
        if (!file.type.startsWith('audio/')) return;
        const track = { name: file.name.replace(/\.[^/.]+$/, ""), file: file, playlist: activePlaylist };
        store.add(track).onsuccess = (ev) => {
            track.id = ev.target.result;
            track.url = URL.createObjectURL(track.file);
            if (!playlists[activePlaylist]) playlists[activePlaylist] = [];
            playlists[activePlaylist].push(track);
            render();
        };
    });
    document.getElementById('audio-input').value = "";
}

function deleteTrack(e, idx) {
    e.stopPropagation();
    if (!db) return;
    const list = playlists[activePlaylist];
    const track = list[idx];
    const tx = db.transaction(['songs'], 'readwrite');
    tx.objectStore('songs').delete(track.id).onsuccess = () => {
        list.splice(idx, 1);
        if (currentTrackIndex === idx) { audio.pause(); audio.src = ""; currentTrackIndex = -1; updatePlayIcon(false); }
        else if (idx < currentTrackIndex) { currentTrackIndex--; }
        render();
    };
}

function changeTrackCover(file) {
    if (currentTrackIndex === -1 || !file || !db) return;
    const track = playlists[activePlaylist][currentTrackIndex];
    if (track.cover) URL.revokeObjectURL(track.cover); 
    track.coverBlob = file;
    track.cover = URL.createObjectURL(file);
    const store = db.transaction(['songs'], 'readwrite').objectStore('songs');
    store.put({ id: track.id, name: track.name, file: track.file, playlist: track.playlist, coverBlob: file }).onsuccess = () => {
        document.getElementById('main-cover').src = track.cover;
        document.getElementById('cover-input').value = "";
        render();
    };
}

function changeBackground(file) {
    if (!file || !db) return;
    updateBackgroundUI(file);
    db.transaction(['settings'], 'readwrite').objectStore('settings').put(file, 'background');
    document.getElementById('bg-input').value = "";
}

function resetBackground() {
    if (!db) return;
    if (bgUrl) URL.revokeObjectURL(bgUrl); 
    document.getElementById('custom-bg').style.backgroundImage = 'none';
    document.getElementById('bg-preview-box').style.backgroundImage = 'none';
    document.getElementById('bg-plus-icon').style.display = 'block';
    db.transaction(['settings'], 'readwrite').objectStore('settings').delete('background');
}


// --- ФУНКЦИИ МОДАЛЬНЫХ ОКОН И НАСТРОЕК ---

function saveEdit() {
    if (!db) return;
    const val = document.getElementById('edit-input').value.trim();
    if (!val) return;
    
    if (editTarget.type === 'create') {
        if (!playlists[val] && val !== DEFAULT_PLAYLIST) {
            playlists[val] = [];
            savePlaylistStructure();
        }
    } else if (editTarget.type === 'playlist') {
        if (editTarget.old === DEFAULT_PLAYLIST) return;
        if(playlists[val]) return alert("Плейлист с таким именем уже существует.");
        playlists[val] = playlists[editTarget.old];
        delete playlists[editTarget.old];
        if (activePlaylist === editTarget.old) activePlaylist = val;
        const store = db.transaction(['songs'], 'readwrite').objectStore('songs');
        playlists[val].forEach(t => {
            t.playlist = val;
            store.put({ id: t.id, name: t.name, file: t.file, playlist: t.playlist, coverBlob: t.coverBlob });
        });
        savePlaylistStructure();
    } else {
        const track = playlists[activePlaylist][editTarget.idx];
        track.name = val;
        const store = db.transaction(['songs'], 'readwrite').objectStore('songs');
        store.put({ id: track.id, name: track.name, file: track.file, playlist: track.playlist, coverBlob: track.coverBlob });
    }
    render(); closeEditModal();
}

function deleteActivePlaylist() {
    if (!db || activePlaylist === DEFAULT_PLAYLIST) return;
    const tx = db.transaction(['songs'], 'readwrite');
    const store = tx.objectStore('songs');
    playlists[activePlaylist].forEach(t => store.delete(t.id));
    delete playlists[activePlaylist];
    activePlaylist = DEFAULT_PLAYLIST;
    savePlaylistStructure();
    render();
    closeConfirmModal();
}

function openMoveModal() {
    if (currentTrackIndex === -1) return;
    const mList = document.getElementById('modal-playlist-list');
    mList.innerHTML = '';
    Object.keys(playlists).forEach(name => {
        const d = document.createElement('div');
        d.className = 'modal-playlist-btn';
        d.textContent = name;
        d.onclick = () => {
            if (!db) return;
            const originalTrack = playlists[activePlaylist][currentTrackIndex];
            const trackCopy = { name: originalTrack.name, file: originalTrack.file, playlist: name, coverBlob: originalTrack.coverBlob };
            db.transaction(['songs'], 'readwrite').objectStore('songs').add(trackCopy).onsuccess = (e) => {
                trackCopy.id = e.target.result;
                trackCopy.url = URL.createObjectURL(trackCopy.file);
                if (trackCopy.coverBlob) trackCopy.cover = URL.createObjectURL(trackCopy.coverBlob);
                if (!playlists[name]) playlists[name] = [];
                playlists[name].push(trackCopy);
                closeMoveModal();
                render();
            };
        };
        mList.appendChild(d);
    });
    document.getElementById('move-modal').style.display = 'flex';
}

// Функции открытия/закрытия модалок
function openSettingsModal() { document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettingsModal() { document.getElementById('settings-modal').style.display = 'none'; }
function openEditModal(type, old, idx = null) { 
    editTarget = { type, old, idx }; 
    document.getElementById('edit-modal-title').textContent = type === 'playlist' ? 'Переименовать плейлист' : 'Переименовать трек';
    document.getElementById('edit-input').value = old; 
    document.getElementById('edit-modal').style.display = 'flex'; 
}
function openCreatePlaylistModal() {
    editTarget = { type: 'create' };
    document.getElementById('edit-modal-title').textContent = 'Новый плейлист';
    document.getElementById('edit-input').value = '';
    document.getElementById('edit-modal').style.display = 'flex';
}
function closeEditModal() { document.getElementById('edit-modal').style.display = 'none'; }
function openDeleteConfirmModal() {
    if (activePlaylist === DEFAULT_PLAYLIST) return;
    document.getElementById('confirm-modal-text').textContent = `Удалить "${activePlaylist}" со всеми треками?`;
    document.getElementById('confirm-modal-btn').onclick = deleteActivePlaylist;
    document.getElementById('confirm-modal').style.display = 'flex';
}
function closeConfirmModal() { document.getElementById('confirm-modal').style.display = 'none'; }
function closeMoveModal() { document.getElementById('move-modal').style.display = 'none'; }


// --- ОБРАБОТЧИКИ СОБЫТИЙ DOM И DRAG-AND-DROP ---

function toggleShuffle() { isShuffle = !isShuffle; document.getElementById('shuffle-btn').classList.toggle('active', isShuffle); }
function toggleRepeat() { isRepeat = !isRepeat; document.getElementById('repeat-btn').classList.toggle('active', isRepeat); }
function handleSearch(v) { searchQuery = v.toLowerCase(); render(); }

document.getElementById('audio-input').onchange = (e) => handleFileUpload(e.target.files);
dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag-over'); };
dz.ondragleave = () => dz.classList.remove('drag-over');
dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag-over'); handleFileUpload(e.dataTransfer.files); };

// МЕТКА ДЛЯ ОТКАТА!!!! // МЕТКА ДЛЯ ОТКАТА!!!! // МЕТКА ДЛЯ ОТКАТА!!!! // МЕТКА ДЛЯ ОТКАТА!!!! // МЕТКА ДЛЯ ОТКАТА!!!!