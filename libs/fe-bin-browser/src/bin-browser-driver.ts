import { default as sqlite3Module } from '@sqlite.org/sqlite-wasm'
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

// Static initialization
const warn = console.warn // sqlite3Module complains about opfs on the main thread
console.warn = () => {}
// when run in node vitest: undici TypeError: fetch failed cause: Error: not implemented... yet...
const sqlite3 = await sqlite3Module() // up to 200ms
setTimeout(() => (console.warn = warn), 100) // without setTimeout 100, it doesn't work

export function makeBrowserSQLite(path = ':memory:'): Database {
  return new sqlite3.oo1.DB(path)
}
