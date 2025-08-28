Implement this demo with react in `apps/frontend/src/app.tsx`. Currently frontend is a vite react template.

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File System Access API Demo</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 2rem auto;
            padding: 0 1rem;
            line-height: 1.6;
        }
        .container {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 2rem;
            margin: 1rem 0;
        }
        button {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            margin: 0.5rem 0;
        }
        button:hover {
            background: #0056b3;
        }
        button:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
        .status {
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 6px;
            border-left: 4px solid #007bff;
            background: #e7f3ff;
        }
        .error {
            border-left-color: #dc3545;
            background: #f8d7da;
            color: #721c24;
        }
        .success {
            border-left-color: #28a745;
            background: #d4edda;
            color: #155724;
        }
        .file-list {
            background: white;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            padding: 1rem;
            margin: 1rem 0;
            max-height: 300px;
            overflow-y: auto;
        }
        .file-item {
            padding: 0.5rem;
            border-bottom: 1px solid #eee;
        }
        .file-item:last-child {
            border-bottom: none;
        }
        code {
            background: #f1f3f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Menlo', monospace;
        }
    </style>
</head>
<body>
    <h1>File System Access API - Folder Permission Demo</h1>

    <div class="container">
        <h2>Feature Overview</h2>
        <p>This demo shows how to:</p>
        <ul>
            <li>Use <code>window.showDirectoryPicker()</code> to select a folder</li>
            <li>Store the directory handle in IndexedDB for persistent access</li>
            <li>Retrieve and use the stored handle without re-prompting</li>
            <li>Read files from the selected directory</li>
        </ul>
    </div>

    <div class="container">
        <h2>API Support Check</h2>
        <div id="support-status" class="status">Checking API support...</div>
    </div>

    <div class="container">
        <h2>Folder Selection</h2>
        <button id="select-folder">Select Folder</button>
        <button id="use-stored-folder" disabled>Use Stored Folder</button>
        <button id="clear-stored-folder">Clear Stored Folder</button>

        <div id="folder-status" class="status" style="display: none;"></div>

        <div id="file-list" class="file-list" style="display: none;">
            <h3>Files in selected folder:</h3>
            <div id="files-container"></div>
        </div>
    </div>

    <script>
        // IndexedDB setup for storing directory handles
        const DB_NAME = 'FileSystemAccess';
        const DB_VERSION = 1;
        const STORE_NAME = 'directoryHandles';

        let db;
        let currentDirectoryHandle;

        // Initialize IndexedDB
        async function initDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    db = request.result;
                    resolve(db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME);
                    }
                };
            });
        }

        // Store directory handle in IndexedDB
        async function storeDirectoryHandle(handle) {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            await store.put(handle, 'selectedDirectory');
        }

        // Retrieve directory handle from IndexedDB
        async function getStoredDirectoryHandle() {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            return new Promise((resolve, reject) => {
                const request = store.get('selectedDirectory');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            });
        }

        // Clear stored directory handle
        async function clearStoredDirectoryHandle() {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            await store.delete('selectedDirectory');
        }

        // Check if File System Access API is supported
        function checkAPISupport() {
            const supportStatus = document.getElementById('support-status');

            if ('showDirectoryPicker' in window) {
                supportStatus.className = 'status success';
                supportStatus.textContent = '✅ File System Access API is supported!';
                return true;
            } else {
                supportStatus.className = 'status error';
                supportStatus.textContent = '❌ File System Access API is not supported in this browser.';
                return false;
            }
        }

        // Select a new folder
        async function selectFolder() {
            try {
                // Request directory access with read permission
                currentDirectoryHandle = await window.showDirectoryPicker({
                    mode: 'read'
                });

                // Store the handle for future use
                await storeDirectoryHandle(currentDirectoryHandle);

                showFolderStatus(`Selected folder: ${currentDirectoryHandle.name}`, 'success');
                document.getElementById('use-stored-folder').disabled = false;

                // List files in the directory
                await listFiles(currentDirectoryHandle);

            } catch (error) {
                if (error.name === 'AbortError') {
                    showFolderStatus('Folder selection was cancelled', 'error');
                } else {
                    showFolderStatus(`Error: ${error.message}`, 'error');
                }
            }
        }

        // Use previously stored folder
        async function useStoredFolder() {
            try {
                const storedHandle = await getStoredDirectoryHandle();

                if (!storedHandle) {
                    showFolderStatus('No stored folder found', 'error');
                    return;
                }

                // Verify permission is still granted
                const permission = await storedHandle.queryPermission({ mode: 'read' });

                if (permission === 'granted') {
                    currentDirectoryHandle = storedHandle;
                    showFolderStatus(`Using stored folder: ${currentDirectoryHandle.name}`, 'success');
                    await listFiles(currentDirectoryHandle);
                } else if (permission === 'prompt') {
                    // Request permission again
                    const newPermission = await storedHandle.requestPermission({ mode: 'read' });
                    if (newPermission === 'granted') {
                        currentDirectoryHandle = storedHandle;
                        showFolderStatus(`Permission granted for: ${currentDirectoryHandle.name}`, 'success');
                        await listFiles(currentDirectoryHandle);
                    } else {
                        showFolderStatus('Permission denied for stored folder', 'error');
                    }
                } else {
                    showFolderStatus('Permission denied for stored folder', 'error');
                }

            } catch (error) {
                showFolderStatus(`Error accessing stored folder: ${error.message}`, 'error');
            }
        }

        // Clear stored folder
        async function clearFolder() {
            try {
                await clearStoredDirectoryHandle();
                currentDirectoryHandle = null;
                document.getElementById('use-stored-folder').disabled = true;
                document.getElementById('file-list').style.display = 'none';
                showFolderStatus('Stored folder cleared', 'success');
            } catch (error) {
                showFolderStatus(`Error clearing folder: ${error.message}`, 'error');
            }
        }

        // List files in directory
        async function listFiles(directoryHandle) {
            try {
                const filesContainer = document.getElementById('files-container');
                const fileList = document.getElementById('file-list');

                filesContainer.innerHTML = '';

                for await (const [name, handle] of directoryHandle.entries()) {
                    const fileItem = document.createElement('div');
                    fileItem.className = 'file-item';

                    if (handle.kind === 'file') {
                        fileItem.innerHTML = `📄 ${name} <small>(file)</small>`;
                    } else {
                        fileItem.innerHTML = `📁 ${name} <small>(directory)</small>`;
                    }

                    filesContainer.appendChild(fileItem);
                }

                fileList.style.display = 'block';

            } catch (error) {
                showFolderStatus(`Error listing files: ${error.message}`, 'error');
            }
        }

        // Show folder status message
        function showFolderStatus(message, type = '') {
            const status = document.getElementById('folder-status');
            status.textContent = message;
            status.className = `status ${type}`;
            status.style.display = 'block';
        }

        // Event listeners
        document.getElementById('select-folder').addEventListener('click', selectFolder);
        document.getElementById('use-stored-folder').addEventListener('click', useStoredFolder);
        document.getElementById('clear-stored-folder').addEventListener('click', clearFolder);

        // Initialize the application
        async function init() {
            // Check API support
            if (!checkAPISupport()) {
                document.getElementById('select-folder').disabled = true;
                return;
            }

            // Initialize IndexedDB
            try {
                await initDB();

                // Check if we have a stored directory handle
                const storedHandle = await getStoredDirectoryHandle();
                if (storedHandle) {
                    document.getElementById('use-stored-folder').disabled = false;

                    // Automatically load files from stored handle
                    try {
                        const permission = await storedHandle.queryPermission({ mode: 'read' });

                        if (permission === 'granted') {
                            currentDirectoryHandle = storedHandle;
                            showFolderStatus(`Auto-loaded folder: ${currentDirectoryHandle.name}`, 'success');
                            await listFiles(currentDirectoryHandle);
                        } else {
                            showFolderStatus(`Stored folder found (${storedHandle.name}) but permission needed`, '');
                        }
                    } catch (error) {
                        showFolderStatus(`Stored folder may be invalid: ${error.message}`, 'error');
                        // Clear invalid handle
                        await clearStoredDirectoryHandle();
                        document.getElementById('use-stored-folder').disabled = true;
                    }
                }
            } catch (error) {
                showFolderStatus(`Database initialization error: ${error.message}`, 'error');
            }
        }

        // Start the application
        init();
    </script>
</body>
</html>
