import { useState, useEffect } from 'react'
import './app.css'

interface FileItem {
  name: string
  kind: FileSystemHandleKind
}

// IndexedDB setup
const DB_NAME = 'FileSystemAccess'
const DB_VERSION = 1
const STORE_NAME = 'directoryHandles'

export function AccessHandlerDemo() {
  const [isSupported, setIsSupported] = useState<boolean | null>(null)
  const [db, setDb] = useState<IDBDatabase | null>(null)
  const [currentDirectory, setCurrentDirectory] = useState<FileSystemDirectoryHandle | null>(null)
  const [hasStoredFolder, setHasStoredFolder] = useState(false)
  const [folderStatus, setFolderStatus] = useState<{ message: string; type: 'success' | 'error' | 'info' }>({ message: '', type: 'info' })
  const [files, setFiles] = useState<FileItem[]>([])
  const [showFileList, setShowFileList] = useState(false)

  // Initialize IndexedDB
  useEffect(() => {
    const initDB = async () => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => {
          console.error('IndexedDB error:', request.error)
          setFolderStatus({ message: 'Database initialization error', type: 'error' })
        }

        request.onsuccess = () => {
          const database = request.result
          setDb(database)
          checkStoredDirectory(database)
        }

        request.onupgradeneeded = (event) => {
          const database = (event.target as IDBOpenDBRequest).result
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME)
          }
        }
      } catch (error) {
        console.error('Error initializing DB:', error)
      }
    }

    // Check API support
    if ('showDirectoryPicker' in window) {
      setIsSupported(true)
      initDB()
    } else {
      setIsSupported(false)
    }
  }, [])

  // Check for stored directory
  const checkStoredDirectory = async (database: IDBDatabase) => {
    try {
      const transaction = database.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get('selectedDirectory')

      request.onsuccess = async () => {
        const storedHandle = request.result as FileSystemDirectoryHandle | undefined
        if (storedHandle) {
          setHasStoredFolder(true)
          // Try to auto-load if permission is granted
          await listFiles(storedHandle)
        }
      }
    } catch (error) {
      console.error('Error checking stored directory:', error)
    }
  }

  // Store directory handle
  const storeDirectoryHandle = async (handle: FileSystemDirectoryHandle) => {
    if (!db) return

    try {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      await store.put(handle, 'selectedDirectory')
      setHasStoredFolder(true)
    } catch (error) {
      console.error('Error storing directory handle:', error)
    }
  }

  // Get stored directory handle
  const getStoredDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (!db) return null

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get('selectedDirectory')

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | null)
    })
  }

  // Clear stored directory
  const clearStoredDirectoryHandle = async () => {
    if (!db) return

    try {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      await store.delete('selectedDirectory')
      setHasStoredFolder(false)
    } catch (error) {
      console.error('Error clearing stored directory:', error)
    }
  }

  // List files in directory
  const listFiles = async (directoryHandle: FileSystemDirectoryHandle) => {
    try {
      const fileList: FileItem[] = []

      for await (const [name, handle] of (directoryHandle as any).entries()) {
        fileList.push({
          name,
          kind: handle.kind
        })
      }

      setFiles(fileList)
      setShowFileList(true)
    } catch (error) {
      console.error('Error listing files:', error)
      setFolderStatus({ message: `Error listing files: ${(error as Error).message}`, type: 'error' })
    }
  }

  // Select folder handler
  const handleSelectFolder = async () => {
    try {
      const directoryHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: 'read' })

      await storeDirectoryHandle(directoryHandle)
      setCurrentDirectory(directoryHandle)
      setFolderStatus({ message: `Selected folder: ${directoryHandle.name}`, type: 'success' })

      await listFiles(directoryHandle)
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setFolderStatus({ message: 'Folder selection was cancelled', type: 'error' })
      } else {
        setFolderStatus({ message: `Error: ${(error as Error).message}`, type: 'error' })
      }
    }
  }

  // Use stored folder handler
  const handleUseStoredFolder = async () => {
    try {
      const storedHandle = await getStoredDirectoryHandle()

      if (!storedHandle) {
        setFolderStatus({ message: 'No stored folder found', type: 'error' })
        return
      }

      const permission: 'granted' | 'prompt' | 'denied' = await (storedHandle as any).queryPermission({ mode: 'read' })

      if (permission === 'granted') {
        setCurrentDirectory(storedHandle)
        setFolderStatus({ message: `Using stored folder: ${storedHandle.name}`, type: 'success' })
        await listFiles(storedHandle)
      } else if (permission === 'prompt') {
        const newPermission: 'granted' | 'prompt' | 'denied' = await (storedHandle as any).requestPermission({ mode: 'read' })
        if (newPermission === 'granted') {
          setCurrentDirectory(storedHandle)
          setFolderStatus({ message: `Permission granted for: ${storedHandle.name}`, type: 'success' })
          await listFiles(storedHandle)
        } else {
          setFolderStatus({ message: 'Permission denied for stored folder', type: 'error' })
        }
      } else {
        setFolderStatus({ message: 'Permission denied for stored folder', type: 'error' })
      }
    } catch (error) {
      setFolderStatus({ message: `Error accessing stored folder: ${(error as Error).message}`, type: 'error' })
    }
  }

  // Clear folder handler
  const handleClearFolder = async () => {
    try {
      await clearStoredDirectoryHandle()
      setCurrentDirectory(null)
      setShowFileList(false)
      setFiles([])
      setFolderStatus({ message: 'Stored folder cleared', type: 'success' })
    } catch (error) {
      setFolderStatus({ message: `Error clearing folder: ${(error as Error).message}`, type: 'error' })
    }
  }

  return (
    <>
      <style>{`
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
        .demo-button {
          background: #007bff;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          margin: 0.5rem 0.5rem 0.5rem 0;
        }
        .demo-button:hover {
          background: #0056b3;
        }
        .demo-button:disabled {
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
        .status.error {
          border-left-color: #dc3545;
          background: #f8d7da;
          color: #721c24;
        }
        .status.success {
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
      `}</style>

      <h1>File System Access API - Folder Permission Demo</h1>

      <div className="container">
        <h2>Feature Overview</h2>
        <p>This demo shows how to:</p>
        <ul>
          <li>Use <code>window.showDirectoryPicker()</code> to select a folder</li>
          <li>Store the directory handle in IndexedDB for persistent access</li>
          <li>Retrieve and use the stored handle without re-prompting</li>
          <li>Read files from the selected directory</li>
        </ul>
      </div>

      <div className="container">
        <h2>API Support Check</h2>
        <div className={`status ${isSupported === true ? 'success' : isSupported === false ? 'error' : ''}`}>
          {isSupported === null ? 'Checking API support...' :
           isSupported ? '✅ File System Access API is supported!' :
           '❌ File System Access API is not supported in this browser.'}
        </div>
      </div>

      <div className="container">
        <h2>Folder Selection</h2>
        <button
          className="demo-button"
          onClick={handleSelectFolder}
          disabled={!isSupported}
        >
          Select Folder
        </button>
        <button
          className="demo-button"
          onClick={handleUseStoredFolder}
          disabled={!isSupported || !hasStoredFolder}
        >
          Use Stored Folder
        </button>
        <button
          className="demo-button"
          onClick={handleClearFolder}
          disabled={!isSupported}
        >
          Clear Stored Folder
        </button>

        {folderStatus.message && (
          <div className={`status ${folderStatus.type}`}>
            {folderStatus.message}
          </div>
        )}

        {showFileList && (
          <div className="file-list">
            <h3>Files in selected folder:</h3>
            <div>
              {files.map((file, index) => (
                <div key={index} className="file-item">
                  {file.kind === 'file' ? '📄' : '📁'} {file.name} <small>({file.kind})</small>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
