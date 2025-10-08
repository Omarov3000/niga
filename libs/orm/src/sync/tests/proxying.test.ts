import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { o } from '../../schema/builder'
import { _makeHttpRemoteDb, UnstableNetworkFetch } from '../test-helpers'
import { ControllableOnlineDetector, AlwaysOnlineDetector } from '../test-online-detector'
import { OrmNodeDriver } from '../../orm-node-driver'
import { SyncedDb } from '../synced-db'

describe('blocking getLatestMutation behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('blocks initialization until getLatestMutation completes', async () => {

    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    const { server } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })

    // Track when get() is called and completed
    let getStarted = false
    let getCompleted = false
    let resolveGet: (() => void) | null = null
    const getPromise = new Promise<void>(resolve => { resolveGet = resolve })

    const trackingFetch = async (url: string, options: RequestInit) => {
      if (url.includes('/sync/get')) {
        getStarted = true
        await getPromise
        const response = await server.handleRequest(url, options.method || 'GET', options.body as string | undefined)
        getCompleted = true
        return response
      }
      return server.handleRequest(url, options.method || 'GET', options.body as string | undefined)
    }

    const detector = new AlwaysOnlineDetector()
    const driver = new OrmNodeDriver()

    // Start client initialization - should block until get() completes
    const clientPromise = o.syncedDb({
      schema: { users },
      driver,
      fetch: trackingFetch,
      skipPull: true,
      onlineDetector: detector,
      debugName: 'client1'
    })

    // Track when initialization completes
    let initCompleted = false
    clientPromise.then(() => { initCompleted = true })

    // Advance time to start get()
    await vi.advanceTimersByTimeAsync(50)

    // Verify get() started but initialization hasn't completed yet
    expect(getStarted).toBe(true)
    expect(getCompleted).toBe(false)
    expect(initCompleted).toBe(false)

    // Manually resolve the get() request
    resolveGet!()
    await vi.runAllTimersAsync()

    // Wait for initialization to complete
    await clientPromise

    // Now everything should be complete
    expect(getCompleted).toBe(true)
    expect(initCompleted).toBe(true)
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
    const driver = new OrmNodeDriver()

    // Start client initialization - should wait for online
    const clientPromise = o.syncedDb({
      schema: { users },
      driver,
      fetch: async (url, options) => server.handleRequest(url, options.method || 'GET', options.body as string | undefined),
      skipPull: true, // Skip pull to test getLatestMutation blocking behavior
      onlineDetector: detector,
      debugName: 'client1'
    })

    // Client should be blocked on waitForOnline()
    let clientReady = false
    clientPromise.then(() => { clientReady = true })

    // Advance timers to let initialization attempt to proceed
    await vi.advanceTimersByTimeAsync(100)
    expect(clientReady).toBe(false)

    // Go online
    detector.setOnline(true)

    // Advance timers to complete initialization
    await vi.runAllTimersAsync()

    // Wait for client to initialize
    const db = await clientPromise
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

    // Setup: Server with sync tables
    const { server } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })

    // Track get() calls to verify mutations are fetched
    let getCalled = false
    let getMutationsCount = 0
    const trackingFetch = async (url: string, options: RequestInit) => {
      if (url.includes('/sync/get')) {
        getCalled = true
        const response = await server.handleRequest(url, options.method || 'GET', options.body as string | undefined)
        // Count how many mutations were returned
        const data = await response.json() as any[]
        getMutationsCount = data.length
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return server.handleRequest(url, options.method || 'GET', options.body as string | undefined)
    }

    const detector1 = new AlwaysOnlineDetector()
    const driver1 = new OrmNodeDriver()

    // Client1: insert data
    const client1 = await o.syncedDb({
      schema: { users },
      driver: driver1,
      fetch: trackingFetch,
      skipPull: true,
      onlineDetector: detector1,
      debugName: 'client1'
    })
    await client1.users.insertWithUndo({ name: 'Alice' })

    // Advance timers to let mutation sync to server
    await vi.runAllTimersAsync()

    // Reset tracking
    getCalled = false
    getMutationsCount = 0

    const detector2 = new AlwaysOnlineDetector()
    const driver2 = new OrmNodeDriver()

    // Client2: initialize - should receive Alice during getLatestMutation phase
    const client2 = await o.syncedDb({
      schema: { users },
      driver: driver2,
      fetch: trackingFetch,
      skipPull: true,
      onlineDetector: detector2,
      debugName: 'client2'
    })

    // Verify get() was called and returned mutations during initialization
    expect(getCalled).toBe(true)
    expect(getMutationsCount).toBe(1)

    // Verify client2 has the data that was synced during getLatestMutation
    const result = await client2.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice' }
    ])

    // Verify sync state is 'synced' after initialization
    expect(client2.syncState).toBe('synced')
  })

  it('allows writes during initialization without blocking', async () => {
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
    const clientDriver = new OrmNodeDriver()

    // Manually create schema and tables
    const syncedDbInstance = new SyncedDb({
      schema: { users },
      driver: clientDriver,
      fetch: slowNetwork.fetch.bind(slowNetwork),
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
    // Tables are wrapped early, so writes can be sent without blocking
    await db.users.insertWithUndo({ name: 'Charlie' })

    // Run all pending timers to complete the network delay and initialization
    await vi.runAllTimersAsync()

    // Wait for init to complete
    await initPromise

    // Verify write was queued and is now visible
    const result = await db.users.select().execute()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Charlie')
  })

  it('sends mutations directly to remote during sync (not queued locally)', async () => {
    // During sync (pulling/gettingLatest), mutations should:
    // 1. NOT be applied locally (local DB is incomplete)
    // 2. NOT be queued locally
    // 3. Be sent directly to remote DB
    // 4. After sync completes, trigger another sync to pull them back

    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    const { server, db: serverDb } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })

    // Create slow network to delay initialization
    const slowNetwork = new UnstableNetworkFetch(server, {
      failPattern: [1, 1, 1], // All succeed
      delayMs: 2000, // 2 second delay on get()
    })

    // Track send() calls to verify mutation is sent to remote
    let sendCalled = false
    const trackingFetch = async (url: string, options: RequestInit) => {
      if (url.includes('/sync/send')) {
        sendCalled = true
        // Don't delay send requests - only delay get() via slowNetwork
        return server.handleRequest(url, options.method || 'GET', options.body as string | undefined)
      }
      return slowNetwork.fetch(url, options)
    }

    const detector = new AlwaysOnlineDetector()
    const clientDriver = new OrmNodeDriver()

    // Manually create instance without awaiting initialization
    const syncedDbInstance = new SyncedDb({
      schema: { users },
      driver: clientDriver,
      fetch: trackingFetch,
      onlineDetector: detector,
      skipPull: true,
      debugName: 'client1'
    })

    // Start initialization in background
    const initPromise = syncedDbInstance.initialize()

    // Track if init is done
    let initDone = false
    initPromise.then(() => { initDone = true })

    // Advance time to let initialization start but not complete
    await vi.advanceTimersByTimeAsync(100)

    // Verify init is NOT done yet (still waiting on delayed get() request)
    expect(initDone).toBe(false)
    expect(syncedDbInstance.syncState).not.toBe('synced')

    // Make a write during sync
    const db = syncedDbInstance as any
    await db.users.insertWithUndo({ name: 'Charlie' })

    // Verify mutation was sent to remote
    expect(sendCalled).toBe(true)

    // Check local queue - mutation should NOT be in local queue during sync
    // (it should be sent directly to remote, not queued locally)
    const localQueue = await clientDriver.run({
      query: 'SELECT * FROM _db_mutations_queue',
      params: []
    })
    expect(localQueue).toHaveLength(0)

    // Complete initialization
    await vi.runAllTimersAsync()
    await initPromise

    // After sync completes, the mutation should be on the server
    const serverUsers = await serverDb.users.select().execute()
    expect(serverUsers).toMatchObject([{ name: 'Charlie' }])

    // After initialization completes, it should have pulled the mutation back
    // so the client now has the data
    const clientUsers = await db.users.select().execute()
    expect(clientUsers).toMatchObject([{ name: 'Charlie' }])
  })
})
