/* Dylan's Local Dev Dashboard — v3 production (single-file)
   - Vanilla JS + tiny modal helper
   - LocalStorage primary + optional File System Access API sync to /data/savedata.example.json // in progress
   - Progress bar calculated from saved data (reliable, collapse-safe)
   - Keeps original features (add/edit/delete, drag/drop, import/export, undo, modals, keyboard shortcuts)
   - IndexedDB persists directory handle when supported
   - Advanced logging + tidy comments
*/

window.addEventListener('DOMContentLoaded', () => {
    'use strict';

    /* -------------------------
       Config / Defaults
       ------------------------- */
    // 🐾 Pawjects Local Storage Identifiers
    const STORAGE_KEY = 'pawjects_dashboard_v1';
    const IDB_DB = 'pawjects-fs-handles';
    const IDB_STORE = 'handles';

    const DEBUG = false; // flip true for extra console logs

    const DEFAULTS = [
        {
            id: "home-quick",
            title: "🏠 Home / Quick — Taskboard Overview",
            tag: "info",
            color: "#38bdf8",
            tasks: [
                { text: "🎯 Purpose: A free, offline taskboard that saves data in your browser.", done: false, desc: "" },
                { text: "⚙️ Quick Start: N = new section, Q = quick add, / = search, Ctrl+E = export, Ctrl+Z = undo.", done: false, desc: "" },
                { text: "📂 Import / Export: Use header buttons to backup or restore saved data.", done: false, desc: "" },
                { text: "🧠 Autosave + Undo: Every edit saves automatically — you can undo the last change.", done: false, desc: "" },
                { text: "🖱️ Drag & Drop: Reorder sections and tasks freely by dragging.", done: false, desc: "" },
                { text: "🎨 Sections: Each can have a title, tag, color, and due date.", done: false, desc: "" },
                { text: "💡 Customize quick links and sidebar IPs to your environment.", done: false, desc: "" }
            ]
        }
    ];

    // Undo snapshot (keep only last destructive state)
    let lastSnapshot = null;

    /* -------------------------
       Optional native file sync
       - dirHandle persisted to IndexedDB if available (structured clone)
       - requires user to "Connect Folder" once to grant permission
       ------------------------- */
    let nativeDirHandle = null; // FileSystemDirectoryHandle or null

    function idbOpen() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) return resolve(null);
            const req = indexedDB.open(IDB_DB, 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore(IDB_STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    }
    async function idbPut(key, val) {
        try {
            const db = await idbOpen();
            if (!db) return false;
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(val, key);
            await new Promise(r => tx.oncomplete = r);
            db.close();
            return true;
        } catch (e) { return false; }
    }
    async function idbGet(key) {
        try {
            const db = await idbOpen();
            if (!db) return null;
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            const res = await new Promise((resolve) => {
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
            db.close();
            return res;
        } catch (e) { return null; }
    }
    async function idbDelete(key) {
        try {
            const db = await idbOpen();
            if (!db) return false;
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).delete(key);
            await new Promise(r => tx.oncomplete = r);
            db.close();
            return true;
        } catch (e) { return false; }
    }

    /* -------------------------
       Mini modal helper (local MicroModal-like)
       ------------------------- */
    const mm = (function () {
        let overlay, container, currentClose;
        function ensure() {
            if (overlay) return;
            overlay = document.createElement('div');
            overlay.className = 'mm-overlay';
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.background = 'rgba(2,6,23,0.7)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '9999';
            overlay.addEventListener('click', (e) => { if (e.target === overlay && currentClose) currentClose(); });

            container = document.createElement('div');
            container.className = 'mm-container';
            container.style.width = 'min(880px, 96%)';
            container.style.maxHeight = '92vh';
            container.style.overflow = 'auto';
            container.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))';
            container.style.padding = '18px';
            container.style.borderRadius = '12px';
            container.style.border = '1px solid rgba(255,255,255,0.03)';
            container.style.boxSizing = 'border-box';

            overlay.appendChild(container);
            document.body.appendChild(overlay);
        }
        function open(html, onOpen = null, onClose = null) {
            ensure();
            container.innerHTML = html;
            overlay.style.display = 'flex';
            currentClose = () => {
                overlay.style.display = 'none';
                if (onClose) onClose();
            };
            if (onOpen) onOpen({ container, close: currentClose });
            return { close: currentClose, container };
        }
        return { open };
    })();

    /* -------------------------
       Utilities
       ------------------------- */
    function uid(prefix = 'id') {
        return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 9000 + 1000).toString(36)}`;
    }
    function nowISO() { return new Date().toISOString(); }
    function escapeHtml(s = '') { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
    function formatDateHuman(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleDateString(); } catch { return iso; } }
    function debounce(fn, ms = 120) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
    function log(...a) { if (DEBUG) console.log('[TODO]', ...a); }

    /* -------------------------
       Storage — localStorage primary (fast), optional native file sync
       ------------------------- */

    // Try to restore persisted native dir handle from IndexedDB
    (async function tryRestoreDirHandle() {
        if (!('showDirectoryPicker' in window)) return;
        const maybe = await idbGet('nativeDirHandle');
        if (maybe) {
            try {
                // browser will give a live handle back (structured clone)
                nativeDirHandle = maybe;
                // test permission
                const permission = await nativeDirHandle.queryPermission({ mode: 'readwrite' });
                if (permission === 'granted') {
                    log('Restored native dir handle from IDB (granted).');
                    // attempt to load file if present
                    await loadFromNativeFileIfExists();
                } else if (permission === 'prompt') {
                    // we keep it but won't auto-write until user approves
                    log('Restored native dir handle — permission prompt required on write.');
                } else {
                    log('Restored handle has no permission; clearing persisted handle.');
                    nativeDirHandle = null;
                    await idbDelete('nativeDirHandle');
                }
            } catch (err) {
                log('Failed restoring native handle:', err);
                nativeDirHandle = null;
                await idbDelete('nativeDirHandle');
            }
        }
    })();

    // ===============================
    // 🗂 Folder Connection / Native Sync (safe fallback)
    // ===============================
    async function connectNativeFolder() {
        console.groupCollapsed("📁 connectNativeFolder()");
        if ('showDirectoryPicker' in window) {
            try {
                nativeDirHandle = await window.showDirectoryPicker();
                console.log("✅ Folder connected:", nativeDirHandle.name);
                localStorage.setItem("native-folder-access", "true");
            } catch (err) {
                console.warn("⚠️ Folder selection cancelled:", err);
                nativeDirHandle = null;
            }
        } else {
            console.warn("🚫 File System Access API not supported — using localStorage only.");
            nativeDirHandle = null;
        }
        console.groupEnd();
    }

    async function ensureNativeFile() {
        if (!nativeDirHandle) return;
        try {
            const fileHandle = await nativeDirHandle.getFileHandle(NATIVE_FILENAME, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write('[]'); // empty JSON
            await writable.close();
            console.log("✅ ensured native file exists:", NATIVE_FILENAME);
        } catch (err) {
            console.warn("⚠️ Could not ensure native file:", err);
        }
    }



    // Save store to localStorage (always) and, if nativeDirHandle available and permitted, also to file
    async function saveData(arr, opts = {}) {
        try {
            if (!Array.isArray(arr)) throw new Error('invalid payload (saveData)');
            // snapshot for undo (unless told to skip)
            if (!opts.skipSnapshot) {
                lastSnapshot = localStorage.getItem(STORAGE_KEY);
            }
            // normalize and persist locally
            localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
            localStorage.setItem(`${STORAGE_KEY}:meta`, JSON.stringify({ ...STORAGE_META, updatedAt: nowISO() }));
            updateLastSaved(nowISO());
            updateGlobalProgress(true); // calculate from stored data (reliable)
            rebuildFilterOptions();

            // attempt native file write if available
            try {
                if (nativeDirHandle && typeof nativeDirHandle.getFileHandle === 'function') {
                    // check permission
                    const perm = await nativeDirHandle.queryPermission({ mode: 'readwrite' });
                    if (perm === 'granted') {
                        await writeToNativeFile(arr);
                        log('Saved to native file.');
                    } else {
                        log('Native dir handle present but not writable; skipping native write.');
                    }
                }
            } catch (err) {
                console.warn('Native write failed:', err);
            }
        } catch (err) {
            console.error('Save error', err);
        }
    }



    // Loads data from localStorage (primary). If native file exists and is newer, prefer that.
    async function loadData() {
        console.groupCollapsed("🧩 loadData()");
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            let parsed;

            if (!raw) {
                console.log("🆕 No local data found — using DEFAULTS.");
                parsed = JSON.parse(JSON.stringify(DEFAULTS));
                await saveData(parsed, { skipSnapshot: true });
            } else {
                try {
                    parsed = JSON.parse(raw);
                    if (!Array.isArray(parsed)) throw new Error("Invalid structure");
                } catch (err) {
                    console.warn("⚠️ Corrupted localStorage data — resetting:", err);
                    parsed = JSON.parse(JSON.stringify(DEFAULTS));
                    await saveData(parsed, { skipSnapshot: true });
                }
            }

            // Filesystem sync if available
            if (nativeDirHandle?.getFileHandle) {
                try {
                    const fileHandle = await nativeDirHandle.getFileHandle(NATIVE_FILENAME, { create: false });
                    const file = await fileHandle.getFile();
                    const txt = await file.text();
                    const json = JSON.parse(txt || '[]');
                    if (Array.isArray(json)) {
                        console.log("💾 Loaded from native file:", NATIVE_FILENAME);
                        parsed = json;
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
                    }
                } catch {
                    console.log("📁 No native file found, skipping.");
                }
            }

            // Ensure “Quick Guide” exists
            if (!parsed.some(s => s.id === "home-quick")) {
                console.log("📘 Injecting quick start section");
                parsed.unshift(JSON.parse(JSON.stringify(DEFAULTS[0])));
                await saveData(parsed, { skipSnapshot: true });
            }

            // Normalize data
            parsed.forEach(section => {
                if (!Array.isArray(section.tasks)) section.tasks = [];
                section.tasks = section.tasks.map(t => ({
                    text: String(t?.text || ''),
                    done: !!t?.done,
                    desc: typeof t?.desc === 'string' ? t.desc : ''
                }));
            });

            console.log(`✅ Loaded ${parsed.length} sections, total tasks:`,
                parsed.reduce((a, s) => a + s.tasks.length, 0));
            console.groupEnd();
            return parsed;
        } catch (err) {
            console.error("❌ Fatal load error:", err);
            console.groupEnd();
            const safe = JSON.parse(JSON.stringify(DEFAULTS));
            await saveData(safe, { skipSnapshot: true });
            return safe;
        }
    }

    // Write JSON to the native file inside chosen folder
    async function writeToNativeFile(arr) {
        if (!nativeDirHandle) throw new Error('No native dir handle');
        const fh = await nativeDirHandle.getFileHandle(NATIVE_FILENAME, { create: true });
        const writable = await fh.createWritable();
        await writable.write(JSON.stringify(arr, null, 2));
        await writable.close();
    }

    // If native file exists, read and load into localStorage (used at startup when dir handle restored)
    async function loadFromNativeFileIfExists() {
        if (!nativeDirHandle) return false;
        try {
            const fh = await nativeDirHandle.getFileHandle(NATIVE_FILENAME, { create: false });
            if (!fh) return false;
            const file = await fh.getFile();
            const txt = await file.text();
            const json = JSON.parse(txt || '[]');
            if (Array.isArray(json)) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
                log('Loaded data from native file into localStorage');
                return true;
            }
        } catch (err) {
            log('No native file to load (or failed)', err);
        }
        return false;
    }

    // Ask user to pick the folder (e.g., your /data/). Persist handle via IDB.
    async function promptConnectFolder() {
        if (!('showDirectoryPicker' in window)) {
            alert('Your browser does not support the File System Access API. Native folder sync unavailable.');
            return;
        }
        try {
            const dir = await window.showDirectoryPicker();
            if (!dir) return;
            nativeDirHandle = dir;
            // persist if possible
            try {
                await idbPut('nativeDirHandle', dir);
                log('Persisted native dir handle to IndexedDB.');
            } catch (e) {
                log('Could not persist dir handle to IndexedDB.', e);
            }
            // ensure file exists
            try {
                const fh = await nativeDirHandle.getFileHandle(NATIVE_FILENAME, { create: true });
                // if it wasn't present, create empty baseline using localStorage data
                const raw = localStorage.getItem(STORAGE_KEY);
                const baseline = raw ? JSON.parse(raw) : DEFAULTS;
                const writable = await fh.createWritable();
                await writable.write(JSON.stringify(baseline, null, 2));
                await writable.close();
                toast('Connected folder & created ' + NATIVE_FILENAME);
                log('Native file created/ensured.');
            } catch (err) {
                console.warn('Failed to ensure native file', err);
            }
            // try to load file into UI immediately
            await loadFromNativeFileIfExists();
            renderAll();
        } catch (err) {
            if (err && err.name === 'AbortError') {
                toast('Folder selection cancelled');
            } else {
                console.error('promptConnectFolder error', err);
                alert('Could not access folder: ' + (err && err.message ? err.message : String(err)));
            }
        }
    }

    /* -------------------------
       UI references & init
       ------------------------- */
    const dynamicContainer = document.getElementById('dynamic-sections');
    const initBtn = document.getElementById('init-section-btn');
    const exportBtn = document.getElementById('export-json');
    const importBtn = document.getElementById('import-json-btn');
    const quickAddBtn = document.getElementById('quick-add-btn');
    const searchInput = document.getElementById('global-search');
    const filterSelect = document.getElementById('filter-select');
    const lastSavedEl = document.getElementById('last-saved');
    const sectionTemplate = document.getElementById('section-template');
    const taskTemplate = document.getElementById('task-template');

    // inject Connect Folder button into header controls (no change to your HTML required)
    //(function injectFolderButton() {
    //    try {
    //        const controls = document.querySelector('.topbar .controls');
    //        if (!controls) return;
    //        const btn = document.createElement('button');
    //        btn.id = 'connect-folder-btn';
    //        btn.className = 'pill';
    //        btn.textContent = '🔗 Connect Folder';
    //        btn.title = 'Connect a local folder to sync savedata.example.json (optional)';
    //        btn.addEventListener('click', promptConnectFolder);
    //        controls.insertBefore(btn, controls.firstChild);
    //    } catch (e) { /* ignore */ }
    //})();

    // tiny toast
    let toastTimer = null;
    function toast(msg, ms = 2200) {
        clearTimeout(toastTimer);
        let t = document.getElementById('__todo_toast');
        if (!t) {
            t = document.createElement('div'); t.id = '__todo_toast';
            t.style.position = 'fixed'; t.style.right = '18px'; t.style.bottom = '18px';
            t.style.padding = '10px 14px'; t.style.borderRadius = '10px';
            t.style.background = 'linear-gradient(90deg,var(--accent-1),var(--accent-2))';
            t.style.color = 'white'; t.style.boxShadow = '0 6px 24px rgba(2,6,23,0.5)';
            document.body.appendChild(t);
        }
        t.textContent = msg; t.style.opacity = '1';
        toastTimer = setTimeout(() => { t.style.opacity = '0'; }, ms);
    }

    /* -------------------------
       Rendering
       ------------------------- */
    function clearUi() { dynamicContainer.innerHTML = ''; }

    async function renderAll() {
        clearUi();
        const sections = await loadData(); // ensure up-to-date source
        const query = (searchInput && searchInput.value || '').trim().toLowerCase();
        const filter = (filterSelect && filterSelect.value) || '';
        sections.forEach(s => renderSection(s, { query, filter }));
        initDragAndDrop();
        updateGlobalProgress(true); // compute from storage
    }

    function renderSection(section, { query = '', filter = '' } = {}) {
        // --- Filter logic ---
        if (filter) {
            const fLower = filter.toLowerCase();
            const tagMatch = (section.tag || '').toLowerCase() === fLower;
            const titleMatch = (section.title || '').toLowerCase().includes(fLower);
            if (!tagMatch && !titleMatch) return;
        }

        if (query) {
            const inTitle = (section.title || '').toLowerCase().includes(query);
            const inTasks = (section.tasks || []).some(
                t => (t.text || '').toLowerCase().includes(query) ||
                    (t.desc || '').toLowerCase().includes(query)
            );
            const inTags = (section.tag || '').toLowerCase().includes(query);
            if (!inTitle && !inTasks && !inTags) return;
        }

        // --- Create section node ---
        const node = sectionTemplate.content.cloneNode(true);
        const sec = node.querySelector('section');
        sec.dataset.id = section.id;
        sec.style.borderLeft = `6px solid ${section.color || '#888'}`;

        // ✅ Collapse/expand project by clicking its title
        const headerLeft = sec.querySelector('.section-header .left');
        if (headerLeft) {
            headerLeft.addEventListener('click', (ev) => {
                if (ev.target.closest('.section-controls')) return;
                const body = sec.querySelector('.section-body');
                if (body) body.classList.toggle('hidden');
            });
        }

        // header
        sec.querySelector('.title').textContent = section.title || 'Untitled';
        sec.querySelector('.tag').textContent = section.tag ? `#${section.tag}` : '';
        sec.querySelector('.due').textContent = section.due ? `• due ${formatDateHuman(section.due)}` : '';

        /* =============================
           ✅ Safe Project Progress Handling
           ============================= */
        const progressBar = sec.querySelector('.progress');
        if (progressBar) {
            const progressContainer = progressBar.closest('.progress-bar');

            // ensure label exists
            let progressLabel = sec.querySelector('.progress-label');
            if (!progressLabel && progressContainer) {
                progressLabel = document.createElement('div');
                progressLabel.className = 'progress-label';
                progressContainer.after(progressLabel);
            }

            // compute progress
            const total = (section.tasks || []).length;
            const done = (section.tasks || []).filter(t => t.done).length;
            const pct = total ? Math.round((done / total) * 100) : 0;

            // apply visuals
            progressBar.style.width = `${pct}%`;
            if (progressLabel) progressLabel.textContent = `${pct}% done`;
        }

        /* ============================= */

        function updateGlobalProgress() {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            const allTasks = data.flatMap(s => s.tasks || []);
            const total = allTasks.length;
            const done = allTasks.filter(t => t.done).length;
            const pct = total ? Math.round((done / total) * 100) : 0;

            const globalBar = document.getElementById('global-progress-bar');
            if (globalBar) globalBar.style.width = `${pct}%`;
        }


        const ul = sec.querySelector('.tasks');
        (section.tasks || []).forEach((t, idx) => {
            const tnode = taskTemplate ? taskTemplate.content.cloneNode(true) : null;
            const li = tnode ? tnode.querySelector('li') : document.createElement('li');

            li.dataset.idx = idx;

            // main row
            const taskMain = li.querySelector('.task-main') || document.createElement('div');
            taskMain.className = 'task-main';

            // left
            const left = taskMain.querySelector('.task-left') || document.createElement('div');
            left.className = 'task-left';

            // checkbox
            let cb = left.querySelector('input[type="checkbox"]');
            if (!cb) {
                cb = document.createElement('input'); cb.type = 'checkbox';
                left.insertBefore(cb, left.firstChild);
            }
            cb.checked = !!t.done;
            cb.dataset.idx = idx;

            // label
            let label = left.querySelector('label');
            if (!label) { label = document.createElement('label'); left.appendChild(label); }
            label.textContent = t.text || '';
            label.title = 'Double-click to edit';


            // actions
            const actions = taskMain.querySelector('.task-actions') || document.createElement('div');
            actions.className = 'task-actions';

            let editBtn = actions.querySelector('.edit-task');
            if (!editBtn) {
                editBtn = document.createElement('button');
                editBtn.className = 'small edit-task';
                editBtn.type = 'button';
                editBtn.textContent = '✎';
                actions.appendChild(editBtn);
            }

            let editDescBtn = actions.querySelector('.edit-desc');
            if (!editDescBtn) {
                editDescBtn = document.createElement('button');
                editDescBtn.className = 'small edit-desc';
                editDescBtn.type = 'button';
                editDescBtn.title = 'Edit description';
                editDescBtn.textContent = '📝';
                actions.appendChild(editDescBtn);
            }

            let delBtn = actions.querySelector('.delete-task');
            if (!delBtn) {
                delBtn = document.createElement('button');
                delBtn.className = 'small delete-task danger';
                delBtn.type = 'button';
                delBtn.textContent = '🗑';
                actions.appendChild(delBtn);
            }

            // description element
            let descBox = li.querySelector('.description');
            if (!descBox) {
                descBox = document.createElement('div');
                descBox.className = 'description';
                li.appendChild(descBox);
            }
            descBox.style.whiteSpace = 'pre-wrap';
            if (t.desc && String(t.desc).trim()) {
                descBox.textContent = t.desc;
                descBox.classList.remove('placeholder');
            } else {
                descBox.textContent = 'Add description...';
                descBox.classList.add('placeholder');
            }

            if (cb.checked) li.classList.add('checked');

            // attach
            if (!taskMain.contains(left)) taskMain.appendChild(left);
            if (!taskMain.contains(actions)) taskMain.appendChild(actions);
            if (!Array.from(li.children).includes(taskMain)) li.insertBefore(taskMain, li.firstChild);

            // set shared dataset info
            [cb, label, editBtn, editDescBtn, delBtn].forEach(el => {
                if (!el) return;
                el.dataset.secId = section.id;
                el.dataset.idx = String(idx);
            });

            /* ===============================
               ✅ Checkbox change handler
               Updates both local + global progress instantly
               =============================== */
            cb.addEventListener('change', async (ev) => {
                const secId = ev.currentTarget.dataset.secId;
                const i = Number(ev.currentTarget.dataset.idx);
                const data = await loadData();
                const sObj = data.find(x => x.id === secId);
                if (!sObj) return;

                // ✅ Update this task’s state
                sObj.tasks[i].done = cb.checked;
                await saveData(data);

                // ✅ Update this project’s progress bar + label immediately
                const sectionNode = document.querySelector(`section[data-id="${secId}"]`);
                if (sectionNode) {
                    const progressBar = sectionNode.querySelector('.progress');
                    const progressLabel = sectionNode.querySelector('.progress-label');

                    const total = sObj.tasks.length;
                    const done = sObj.tasks.filter(t => t.done).length;
                    const pct = total ? Math.round((done / total) * 100) : 0;

                    if (progressBar) progressBar.style.width = `${pct}%`;
                    if (progressLabel) progressLabel.textContent = `${pct}% done`;
                }

                // ✅ Update global progress bar
                updateGlobalProgress(true);
            });

            /* ===============================
               ✅ Progress bar setup (on render)
               =============================== */
            const progressBar = sec.querySelector('.progress');
            const progressContainer = progressBar?.closest('.progress-bar');

            // Add progress label if not present
            let progressLabel = sec.querySelector('.progress-label');
            if (!progressLabel && progressContainer) {
                progressLabel = document.createElement('div');
                progressLabel.className = 'progress-label';
                progressLabel.style.marginTop = '6px';
                progressLabel.style.fontSize = '0.85rem';
                progressLabel.style.color = 'var(--muted)';
                progressContainer.after(progressLabel);
            }

            // Compute section-specific progress on render
            const totalTasks = (section.tasks || []).length;
            const doneTasks = (section.tasks || []).filter(t => t.done).length;
            const pct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

            // Apply styles on render
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressLabel) progressLabel.textContent = `${pct}% done`;

            // 🧠 Unified click toggle for entire task (not just label)
            li.addEventListener('click', (ev) => {
                // Ignore clicks on checkboxes or buttons (so editing/deleting still works)
                if (ev.target.closest('.task-actions') || ev.target.type === 'checkbox') return;

                const descNode = li.querySelector('.description');
                if (!descNode) return;

                const secId = li.dataset.secId || ev.currentTarget.dataset.secId;
                const i = Number(li.dataset.idx);
                const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
                const sec = data.find(s => s.id === secId);
                const task = sec?.tasks[i];

                // If description empty → open modal, else toggle visibility
                if (task && (!task.desc || !task.desc.trim())) {
                    openDescModal(secId, i, '');
                } else {
                    descNode.classList.toggle('visible');
                }
            });



            // single click: toggle description
            label.addEventListener('click', (ev) => {
                const liNode = ev.currentTarget.closest('li');
                const descNode = liNode && liNode.querySelector('.description');
                if (!descNode) return;

                // If there's no text in desc, open modal (so user can add description)
                const secId = ev.currentTarget.dataset.secId;
                const i = Number(ev.currentTarget.dataset.idx);
                const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
                const sec = data.find(s => s.id === secId);
                const task = sec?.tasks[i];
                if (task && (!task.desc || !task.desc.trim())) {
                    openDescModal(secId, i, '');
                } else {
                    descNode.classList.toggle('visible');
                }
            });

            editBtn.addEventListener('click', async (ev) => {
                const secId = ev.currentTarget.dataset.secId;
                const i = Number(ev.currentTarget.dataset.idx);
                const data = await loadData();
                const sObj = data.find(x => x.id === secId);
                if (!sObj) return;

                openTaskModal(secId, i, sObj.tasks[i].text || '');
            });


            // 📝 Edit Description button (modern modal)
            if (editDescBtn) {
                editDescBtn.addEventListener('click', async (ev) => {
                    const secId = ev.currentTarget.dataset.secId;
                    const i = Number(ev.currentTarget.dataset.idx);
                    const data = await loadData();
                    const sObj = data.find(x => x.id === secId);
                    if (!sObj) return;

                    const task = sObj.tasks[i];

                    // Open modal
                    const modal = document.getElementById('desc-modal');
                    const textarea = document.getElementById('desc-input');
                    const saveBtn = document.getElementById('desc-save');
                    const cancelBtn = document.getElementById('desc-cancel');

                    textarea.value = task.desc || '';
                    modal.classList.remove('hidden');

                    // Cleanup any old listeners to avoid stacking
                    const closeModal = () => modal.classList.add('hidden');
                    const saveHandler = async () => {
                        task.desc = textarea.value.trim();
                        await saveData(data);
                        renderAll();
                        closeModal();
                    };

                    saveBtn.onclick = saveHandler;
                    cancelBtn.onclick = closeModal;

                    // Close modal on Escape
                    modal.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') closeModal();
                    });

                    textarea.focus();
                });
            }


            delBtn.addEventListener('click', async (ev) => {
                const secId = ev.currentTarget.dataset.secId;
                const i = Number(ev.currentTarget.dataset.idx);
                if (!confirm('Delete task?')) return;
                const data = await loadData();
                const sec = data.find(s => s.id === secId);
                if (!sec) return;
                sec.tasks.splice(i, 1);
                await saveData(data);
                renderAll();
                toast('Task removed');
            });

            ul.appendChild(li);

            // collapse/expand section when clicking its title area
            const headerLeft = node.querySelector('.section-header .left');
            const body = node.querySelector('.section-body');
            if (headerLeft && body) {
                headerLeft.addEventListener('click', (ev) => {
                    // ignore if clicking on section controls (buttons)
                    if (ev.target.closest('.section-controls')) return;
                    body.classList.toggle('hidden');
                });
            }
            setTimeout(() => {
                headerLeft.addEventListener('click', (ev) => {
                    if (ev.target.closest('.section-controls')) return;
                    body.classList.toggle('hidden');
                });
            }, 0);

        });

        // inline add
        const inline = sec.querySelector('.inline-input');
        if (inline) {
            inline.addEventListener('keydown', async (ev) => {
                if (ev.key === 'Enter') {
                    const text = inline.value.trim();
                    if (!text) return;
                    const data = await loadData(); const sObj = data.find(x => x.id === section.id);
                    if (!sObj) return;
                    sObj.tasks.push({ text, done: false, desc: '' });
                    inline.value = '';
                    await saveData(data);
                    renderAll();
                }
            });
        }

        // header controls
        const addTaskBtn = sec.querySelector('.add-task');
        const editSectionBtn = sec.querySelector('.edit-section');
        const deleteSectionBtn = sec.querySelector('.delete-section');
        const collapseBtn = sec.querySelector('.collapse');
        const sectionBody = sec.querySelector('.section-body');

        if (addTaskBtn) addTaskBtn.addEventListener('click', async () => {
            const q = prompt('New task');
            if (!q) return;
            const data = await loadData(); const sObj = data.find(x => x.id === section.id);
            sObj.tasks.push({ text: q.trim(), done: false, desc: '' });
            await saveData(data); renderAll();
        });

        if (editSectionBtn) editSectionBtn.addEventListener('click', () => openEditModal(section));
        if (deleteSectionBtn) deleteSectionBtn.addEventListener('click', async () => {
            if (!confirm(`Delete section "${section.title}"?`)) return;
            const data = await loadData();
            const filtered = data.filter(s => s.id !== section.id);
            await saveData(filtered);
            renderAll();
            toast('Section deleted');
        });

        if (collapseBtn) {
            collapseBtn.dataset.secId = section.id;
            collapseBtn.addEventListener('click', (ev) => {
                const btn = ev.currentTarget;
                const body = btn.closest('section').querySelector('.section-body');
                if (!body) return;
                body.classList.toggle('hidden');
                btn.textContent = body.classList.contains('hidden') ? '▸' : '▾';
            });
        }

        const progEl = sec.querySelector('.progress');
        if (progEl) updateProgressFor(section.id, progEl);


        dynamicContainer.appendChild(node);
    }

    /* -------------------------
       Progress (section + global)
       - Global progress calculated from stored data (reliable)
       ------------------------- */
    function updateProgressFor(sectionId, progressElement) {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const sec = data.find(s => s.id === sectionId);
        if (!sec) { if (progressElement) progressElement.style.width = '0%'; return; }
        const total = sec.tasks.length || 0;
        const done = sec.tasks.filter(t => t.done).length;
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);
        if (progressElement) progressElement.style.width = pct + '%';
    }

    // global: fromStorage=true means compute from storage rather than DOM (preferred)
    function updateGlobalProgress(fromStorage = true) {
        const bar = document.getElementById('global-progress-bar');
        if (!bar) return;
        let total = 0, done = 0;
        if (fromStorage) {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            const all = (data || []).flatMap(s => s.tasks || []);
            total = all.length;
            done = all.filter(t => !!t.done).length;
        } else {
            const allInputs = Array.from(document.querySelectorAll('.todo-section:not(.static-readme) .tasks input[type="checkbox"]'));
            total = allInputs.length;
            done = allInputs.filter(cb => cb.checked).length;
        }
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);
        bar.style.width = pct + '%';
        bar.setAttribute('aria-valuenow', String(pct));
    }

    function updateLastSaved(iso) {
        if (!lastSavedEl) return;
        try { lastSavedEl.textContent = `Saved ${new Date(iso).toLocaleString()}`; } catch { lastSavedEl.textContent = `Saved ${iso}`; }
    }

    /* -------------------------
       Modals (init/edit section, edit description)
       ------------------------- */
    function openInitModal(prefill = {}) {
        const html = `
      <h3>Create New Section</h3>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <input id="mm-sec-title" placeholder="Section title (required)" style="flex:1;padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.1)" />
        <input id="mm-sec-color" type="color" value="${escapeHtml(prefill.color || '#38bdf8')}" style="width:84px;border-radius:6px;padding:4px" />
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <input id="mm-sec-tag" placeholder="Tag (e.g. infra)" style="flex:1;padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.1)" />
        <input id="mm-sec-due" type="date" style="padding:8px;border-radius:6px" />
      </div>
      <label style="margin-top:8px;display:block">Tasks — one per line</label>
      <textarea id="mm-sec-tasks" rows="6" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,0.08);margin-top:6px" placeholder="task one\ntask two"></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button id="mm-cancel" class="small">Cancel</button>
        <button id="mm-create" class="pill">Create</button>
      </div>
    `;
        const m = mm.open(html, ({ container, close }) => {
            container.querySelector('#mm-cancel').addEventListener('click', close);
            container.querySelector('#mm-create').addEventListener('click', async () => {
                const title = container.querySelector('#mm-sec-title').value.trim();
                const color = container.querySelector('#mm-sec-color').value;
                const tag = container.querySelector('#mm-sec-tag').value.trim();
                const due = container.querySelector('#mm-sec-due').value || '';
                const tasks = (container.querySelector('#mm-sec-tasks').value || '').split('\n').map(s => s.trim()).filter(Boolean);
                if (!title) { alert('Section title is required'); return; }
                const obj = { id: uid('sec'), title, color, tag, due, tasks: tasks.map(t => ({ text: t, done: false, desc: '' })) };
                const data = await loadData(); data.unshift(obj);
                await saveData(data);
                close(); renderAll(); toast('Section created');
            });
        });
    }

    function openEditModal(section) {
        const html = `
      <h3>Edit Section</h3>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <input id="mm-sec-title" placeholder="Section title" value="${escapeHtml(section.title)}" style="flex:1;padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.1)" />
        <input id="mm-sec-color" type="color" value="${escapeHtml(section.color || '#38bdf8')}" style="width:84px;border-radius:6px;padding:4px" />
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <input id="mm-sec-tag" placeholder="Tag" value="${escapeHtml(section.tag || '')}" style="flex:1;padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.1)" />
        <input id="mm-sec-due" type="date" value="${escapeHtml(section.due || '')}" style="padding:8px;border-radius:6px" />
      </div>
      <label style="margin-top:8px;display:block">Tasks — one per line (will reset done & desc)</label>
      <textarea id="mm-sec-tasks" rows="6" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,0.08);margin-top:6px">${(section.tasks || []).map(t => escapeHtml(t.text)).join('\n')}</textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button id="mm-cancel" class="small">Cancel</button>
        <button id="mm-save" class="pill">Save</button>
      </div>
    `;
        const m = mm.open(html, ({ container, close }) => {
            container.querySelector('#mm-cancel').addEventListener('click', close);
            container.querySelector('#mm-save').addEventListener('click', async () => {
                const title = container.querySelector('#mm-sec-title').value.trim();
                const color = container.querySelector('#mm-sec-color').value;
                const tag = container.querySelector('#mm-sec-tag').value.trim();
                const due = container.querySelector('#mm-sec-due').value || '';
                const tasksRaw = (container.querySelector('#mm-sec-tasks').value || '').split('\n').map(s => s.trim()).filter(Boolean);
                if (!title) { alert('Section title required'); return; }
                const data = await loadData(); const sec = data.find(s => s.id === section.id);
                if (!sec) return;
                sec.title = title; sec.color = color; sec.tag = tag; sec.due = due;
                sec.tasks = tasksRaw.map(t => ({ text: t, done: false, desc: '' }));
                await saveData(data); close(); renderAll(); toast('Section saved');
            });
        });
    }

function openTaskModal(sectionId, taskIdx, current = '') {
    const modal = document.getElementById('task-modal');
    const input = document.getElementById('task-input');
    const saveBtn = document.getElementById('task-save');
    const cancelBtn = document.getElementById('task-cancel');

    input.value = current || '';
    modal.classList.remove('hidden');

    const closeModal = () => modal.classList.add('hidden');

    cancelBtn.onclick = closeModal;

    saveBtn.onclick = async () => {
        const newText = input.value.trim();
        if (!newText) return;
        const data = await loadData();
        const sec = data.find(s => s.id === sectionId);
        if (!sec || !sec.tasks[taskIdx]) return;
        sec.tasks[taskIdx].text = newText;
        await saveData(data);
        closeModal();
        renderAll();
        toast('✅ Task updated');
    };

    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveBtn.click();
        if (e.key === 'Escape') closeModal();
    });

    input.focus();
}




    /* -------------------------
       Import / Export
       ------------------------- */
    exportBtn.addEventListener('click', async () => {
        const data = await loadData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `dashboard_backup_${(new Date()).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Exported JSON');
    });

    importBtn.addEventListener('click', () => {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
            const file = input.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const json = JSON.parse(reader.result);
                    if (!Array.isArray(json)) throw new Error('Invalid format: expected array of sections');
                    // validate
                    for (const s of json) {
                        if (typeof s.id !== 'string' || typeof s.title !== 'string' || !Array.isArray(s.tasks)) throw new Error('Invalid section shape');
                        for (const t of s.tasks) {
                            if (typeof (t && t.text) !== 'string') throw new Error('Invalid task shape: missing text');
                        }
                    }
                    lastSnapshot = localStorage.getItem(STORAGE_KEY);
                    const normalized = json.map(s => ({
                        id: s.id,
                        title: s.title,
                        tag: s.tag || '',
                        color: s.color || '#888',
                        due: s.due || '',
                        tasks: (s.tasks || []).map(t => ({ text: String(t.text || ''), done: !!t.done, desc: typeof t.desc === 'string' ? t.desc : '' }))
                    }));
                    await saveData(normalized);
                    renderAll();
                    toast('Imported JSON successfully');
                } catch (err) {
                    alert('Import failed: ' + (err && err.message ? err.message : String(err)));
                }
            };
            reader.readAsText(file);
        });
        input.click();
    });

    /* -------------------------
       Quick Add
       ------------------------- */
    quickAddBtn.addEventListener('click', async () => {
        const data = await loadData();
        if (!data.length) { openInitModal(); return; }
        const q = prompt('Quick add task to top section');
        if (!q) return;
        data[0].tasks.unshift({ text: q.trim(), done: false, desc: '' });
        await saveData(data);
        renderAll();
        toast('Quick task added');
    });

    /* -------------------------
       Search + Filter
       ------------------------- */
    searchInput.addEventListener('input', debounce(() => renderAll(), 180));
    filterSelect.addEventListener('change', () => renderAll());

    function rebuildFilterOptions() {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const tags = Array.from(new Set(data.map(s => (s.tag || '').trim()).filter(Boolean)));
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">Filter: All</option>' + tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        }
    }

    /* -------------------------
       Drag & Drop
       ------------------------- */
    function initDragAndDrop() {
        const sections = Array.from(document.querySelectorAll('.todo-section'));
        sections.forEach(sec => {
            sec.removeEventListener('dragstart', sectionDragStart);
            sec.removeEventListener('dragover', sectionDragOver);
            sec.removeEventListener('drop', sectionDrop);
            sec.removeEventListener('dragend', sectionDragEnd);

            sec.addEventListener('dragstart', sectionDragStart);
            sec.addEventListener('dragover', sectionDragOver);
            sec.addEventListener('drop', sectionDrop);
            sec.addEventListener('dragend', sectionDragEnd);

            const ul = sec.querySelector('ul.tasks');
            if (!ul) return;
            Array.from(ul.querySelectorAll('li')).forEach(li => {
                li.removeEventListener('dragstart', taskDragStart);
                li.removeEventListener('dragover', taskDragOver);
                li.removeEventListener('drop', taskDrop);
                li.removeEventListener('dragend', taskDragEnd);

                li.addEventListener('dragstart', taskDragStart);
                li.addEventListener('dragover', taskDragOver);
                li.addEventListener('drop', taskDrop);
                li.addEventListener('dragend', taskDragEnd);
            });
        });
    }

    let draggingSectionId = null;
    function sectionDragStart(e) { this.classList.add('dragging'); draggingSectionId = this.dataset.id; e.dataTransfer.effectAllowed = 'move'; }
    function sectionDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    function sectionDrop(e) {
        e.preventDefault();
        const fromId = draggingSectionId;
        const toId = this.dataset.id;
        if (!fromId || !toId || fromId === toId) return;
        (async () => {
            const data = await loadData();
            const fromIdx = data.findIndex(s => s.id === fromId);
            const toIdx = data.findIndex(s => s.id === toId);
            if (fromIdx === -1 || toIdx === -1) return;
            const [moved] = data.splice(fromIdx, 1);
            data.splice(toIdx, 0, moved);
            await saveData(data);
            renderAll();
        })();
    }
    function sectionDragEnd() { this.classList.remove('dragging'); draggingSectionId = null; }

    let draggingTask = null;
    function taskDragStart(e) {
        this.classList.add('dragging');
        const secEl = this.closest('.todo-section');
        draggingTask = { secId: secEl && secEl.dataset && secEl.dataset.id, idx: Number(this.dataset.idx) };
        e.dataTransfer.effectAllowed = 'move';
    }
    function taskDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    function taskDrop(e) {
        e.preventDefault();
        const targetLi = this;
        const targetSecEl = targetLi.closest('.todo-section');
        if (!draggingTask || !targetSecEl) return;
        (async () => {
            const toSecId = targetSecEl.dataset.id;
            const data = await loadData();
            const fromSec = data.find(s => s.id === draggingTask.secId);
            const toSec = data.find(s => s.id === toSecId);
            if (!fromSec || !toSec) return;
            const [moved] = fromSec.tasks.splice(draggingTask.idx, 1);
            const toIdx = Number(targetLi.dataset.idx);
            toSec.tasks.splice(toIdx, 0, moved);
            await saveData(data); renderAll();
            draggingTask = null;
        })();
    }
    function taskDragEnd() { this.classList.remove('dragging'); }

    /* -------------------------
       Keyboard shortcuts
       ------------------------- */
    window.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        const isTyping = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
        if (isTyping) return;
        if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) openInitModal();
        if (e.key === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey) { if (quickAddBtn) quickAddBtn.click(); }
        if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (searchInput) searchInput.focus(); }
        if (e.key.toLowerCase() === 'e' && e.ctrlKey) { e.preventDefault(); if (exportBtn) exportBtn.click(); }
        if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); restoreLastSnapshot(); }
    });

    /* -------------------------
       Init bootstrap
       ------------------------- */
    async function init() {
        if (initBtn) initBtn.addEventListener('click', () => openInitModal());
        if (document.getElementById('connect-folder-btn')) {
            document.getElementById('connect-folder-btn').addEventListener('click', promptConnectFolder);
        }
        rebuildFilterOptions();
        await renderAll();

        const metaRaw = localStorage.getItem(`${STORAGE_KEY}:meta`);
        if (metaRaw) {
            try { const m = JSON.parse(metaRaw); if (m.updatedAt) updateLastSaved(m.updatedAt); } catch { }
        }

        // expose helper
        window.saveOrder = async function () {
            const ids = Array.from(document.querySelectorAll('.todo-section')).map(el => el.dataset.id);
            const data = await loadData();
            const reordered = ids.map(id => data.find(s => s.id === id)).filter(Boolean);
            await saveData(reordered);
        };
    }



    init();

}); // DOMContentLoaded