import { ulid } from 'ulidx'
import { describe, it, expect, vi } from 'vitest'
import { o } from '../../schema/builder'
import { createFetchWrapper } from '../fetch-wrapper'
import { RemoteDbClient } from '../remote-db'
import { _makeRemoteDb, _makeClientDb, _makeHttpRemoteDb, UnstableNetworkFetch } from '../test-helpers'
import { ControllableOnlineDetector, AlwaysOnlineDetector } from '../test-online-detector'
import { DbMutationBatch } from '../types'
import { OrmNodeDriver } from '../../orm-node-driver'
import { SyncedDb } from '../synced-db'

describe('blocking getLatestMutation behavior', () => {
  it('blocks initialization until getLatestMutation completes', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    const { db: serverDb, remoteDb: serverRemoteDb } = await _makeRemoteDb({ users })
    await serverDb.users.insertMany([
      { name: 'Alice' },
      { name: 'Bob' },
    ])

    const batch: DbMutationBatch = {
      id: ulid(),
      dbName: 'synced',
      mutation: [{
        table: 'users',
        type: 'insert',
        data: [{ name: 'Alice' }, { name: 'Bob' }],
        undo: { type: 'delete', ids: [] }
      }],
      node: { id: ulid(), name: 'server' }
    }
    await serverRemoteDb.send([batch])

    // Client should block during initialization until getLatestMutation completes
    const { db } = await _makeClientDb({ users }, serverRemoteDb, {
      skipPull: false,
      debugName: 'client1'
    })

    // After initialization, reads should have all the data from server
    const result = await db.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice' },
      { name: 'Bob' },
    ])
  })

  it('waits for online before completing getLatestMutation when offline', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    // Setup: Server with existing data
    const { server } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })

    // Create detector that starts offline
    const detector = new ControllableOnlineDetector(false)

    // Network will wait for online
    const wrappedFetch = createFetchWrapper(
      async (url, options) => server.handleRequest(url, options.method || 'GET', options.body as string | undefined),
      detector
    )
    const remoteDb = new RemoteDbClient(wrappedFetch)

    // Start client initialization - should wait for online
    const clientPromise = _makeClientDb({ users }, remoteDb, {
      skipPull: true, // Skip pull to test getLatestMutation blocking behavior
      onlineDetector: detector,
      debugName: 'client1'
    })

    // Give some time for initialization to block
    await new Promise(resolve => setTimeout(resolve, 100))

    // Client should be blocked on waitForOnline()
    let clientReady = false
    clientPromise.then(() => { clientReady = true })

    await new Promise(resolve => setTimeout(resolve, 100))
    expect(clientReady).toBe(false)

    // Go online
    detector.setOnline(true)

    // Wait for client to initialize
    const { db } = await clientPromise
    expect(clientReady).toBe(true)

    // Now operations should work
    await db.users.insertWithUndo({ name: 'Alice' })
    const result = await db.users.select().execute()
    expect(result).toHaveLength(1)
  })

  it('syncs mutations from server during getLatestMutation phase', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    // Setup: Two clients connected to same server
    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert data
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })
    await client1.users.insertWithUndo({ name: 'Alice' })

    // Client2: initialize - should receive Alice during getLatestMutation
    const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })

    // Verify client2 has the data that was inserted by client1
    const result = await client2.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice' }
    ])

    // Verify sync state is 'synced' after initialization
    expect(client2.syncState).toBe('synced')
  })

  it('allows writes to queue during initialization without blocking', async () => {
    vi.useFakeTimers()

    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    // Setup: Server with slow network
    const { server } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })

    // Create slow network that delays requests
    const slowNetwork = new UnstableNetworkFetch(server, {
      failPattern: [1, 1, 1], // All succeed
      delayMs: 2000, // 2 second delay
    })

    const detector = new AlwaysOnlineDetector()
    const wrappedFetch = createFetchWrapper(slowNetwork.fetch.bind(slowNetwork), detector)
    const remoteDb = new RemoteDbClient(wrappedFetch)

    // Get a driver to manually create the DB without waiting for initialization
    const clientDriver = new OrmNodeDriver()

    // Manually create schema and tables
    const syncedDbInstance = new SyncedDb({
      schema: { users },
      driver: clientDriver,
      remoteDb,
      onlineDetector: detector,
      skipPull: true,
      debugName: 'client1'
    })

    // Start initialization in background (don't await)
    const initPromise = syncedDbInstance.initialize()

    // Track if init is done
    let initDone = false
    initPromise.then(() => { initDone = true })

    // Advance time to start initialization but not complete the delay
    await vi.advanceTimersByTimeAsync(100)

    // Verify init is NOT done yet (still waiting on delayed network request)
    expect(initDone).toBe(false)

    // Cast to access user tables - they should be wrapped now even during init
    const db = syncedDbInstance as any

    // Try to make a write - this should work even though initialization is pending
    // Tables are wrapped early, so writes can be queued
    await db.users.insertWithUndo({ name: 'Charlie' })

    // Run all pending timers to complete the network delay and initialization
    await vi.runAllTimersAsync()

    // Wait for init to complete
    await initPromise

    // Verify write was queued and is now visible
    const result = await db.users.select().execute()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Charlie')

    vi.useRealTimers()
  })
})
