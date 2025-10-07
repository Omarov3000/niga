import { ulid } from 'ulidx'
import { describe, it, vi, expect, beforeEach, afterEach } from 'vitest'
import { o } from '../../schema/builder'
import { _makeHttpRemoteDb, UnstableNetworkFetch } from '../test-helpers'
import { AlwaysOnlineDetector } from '../test-online-detector'
import { DbMutationBatch } from '../types'
import { OrmNodeDriver } from '../../orm-node-driver'

describe('network instability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries pull when network fails initially', async () => {

    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    const { db: serverDb, server } = await _makeHttpRemoteDb({ users })
    await serverDb.users.insertMany([
      { name: 'Alice' },
      { name: 'Bob' },
    ])

    const unstableNetwork = new UnstableNetworkFetch(server, {
      failPattern: [0, 0, 1], // Fail twice, succeed third time
    })

    const detector = new AlwaysOnlineDetector()
    const driver = new OrmNodeDriver()

    const clientPromise = o.syncedDb({
      schema: { users },
      driver,
      fetch: unstableNetwork.fetch.bind(unstableNetwork),
      skipPull: false,
      onlineDetector: detector,
      debugName: 'client1'
    })

    await vi.runAllTimersAsync()

    const db = await clientPromise

    // Verify network instability occurred: both pull() and get() should have retried
    // Pattern [0,0,1] means each endpoint fails twice then succeeds = 6 total calls
    expect(unstableNetwork.getCallCount()).toBe(6)

    const result = await db.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice' },
      { name: 'Bob' },
    ])
  })

  it('retries getting latest mutations when network fails', async () => {

    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    // Setup: server with mutations already in the mutations queue
    const { db: serverDb, server } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })

    // Create a mutation batch to be synced via get()
    const aliceId = ulid()
    const bobId = ulid()
    const batch: DbMutationBatch = {
      id: ulid(),
      dbName: 'synced',
      mutation: [{
        table: 'users',
        type: 'insert',
        data: [{ id: aliceId, name: 'Alice' }, { id: bobId, name: 'Bob' }],
        undo: { type: 'delete', ids: [aliceId, bobId] }
      }],
      node: { id: ulid(), name: 'other-client' }
    }

    // Directly insert into server's mutation queue AND apply the data
    // (simulating a mutation from another client that already synced)
    await serverDb.users.insertMany([
      { id: aliceId, name: 'Alice' },
      { id: bobId, name: 'Bob' }
    ])
    await (serverDb as any)._db_mutations_queue.insert({
      id: batch.id,
      value: JSON.stringify(batch),
      serverTimestampMs: Date.now()
    })

    // Now create unstable network for client
    const unstableNetwork = new UnstableNetworkFetch(server, {
      failPattern: [0, 0, 1], // Fail twice, succeed third time
    })

    const detector = new AlwaysOnlineDetector()
    const driver = new OrmNodeDriver()

    // Client initializes - skip pull, only get() will fail/retry
    const clientPromise = o.syncedDb({
      schema: { users },
      driver,
      fetch: unstableNetwork.fetch.bind(unstableNetwork),
      skipPull: true,
      onlineDetector: detector,
      debugName: 'client1'
    })

    await vi.runAllTimersAsync()

    const db = await clientPromise

    // Verify network instability occurred: only get() should have retried (pull was skipped)
    // Pattern [0,0,1] means get() fails twice then succeeds = 3 total calls
    expect(unstableNetwork.getCallCount()).toBe(3)

    // Verify client received the mutations through retried get()
    const result = await db.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice' },
      { name: 'Bob' },
    ])
  })

  it('resumes sending queued mutations after restart', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    const { db: serverDb, server } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })
    const clientDriver = new OrmNodeDriver()

    // Track send requests to verify mutation is sent after restart
    let sendCount = 0
    const trackingFetch = async (url: string, options: RequestInit) => {
      if (url.includes('/sync/send')) {
        sendCount++
      }
      return server.handleRequest(url, options.method || 'GET', options.body as string | undefined)
    }

    // Phase 1: Create client with stable network, make mutation, it succeeds
    const detector1 = new AlwaysOnlineDetector()

    const client1 = await o.syncedDb({
      schema: { users },
      driver: clientDriver,
      fetch: trackingFetch,
      skipPull: true,
      onlineDetector: detector1,
      debugName: 'client1'
    })

    // Make a mutation that will be sent successfully
    const insertPromise = client1.users.insertWithUndo({ name: 'Alice' })
    await vi.runAllTimersAsync()
    await insertPromise
    await vi.runAllTimersAsync()

    // Verify it was synced and send was called once
    let queued1 = await clientDriver.run({
      query: 'SELECT server_timestamp_ms FROM _db_mutations_queue',
      params: [],
    })
    expect(queued1).toHaveLength(1)
    expect(queued1[0].server_timestamp_ms).toBeGreaterThan(0)
    expect(sendCount).toBe(1)

    // Now manually set it back to 0 to simulate a failed send that needs retry
    await clientDriver.run({
      query: 'UPDATE _db_mutations_queue SET server_timestamp_ms = 0',
      params: [],
    })

    // Verify it's now marked as unsent
    let queued2 = await clientDriver.run({
      query: 'SELECT server_timestamp_ms FROM _db_mutations_queue',
      params: [],
    })
    expect(queued2).toHaveLength(1)
    expect(queued2[0].server_timestamp_ms).toBe(0)

    // Phase 2: Simulate restart (same server)
    const detector2 = new AlwaysOnlineDetector()

    // Create new synced-db instance - should retry sending the queued mutation
    const client2 = await o.syncedDb({
      schema: { users },
      driver: clientDriver, // Reuse same driver
      fetch: trackingFetch, // Use same tracking fetch
      skipPull: true,
      onlineDetector: detector2,
      debugName: 'client1-restarted'
    })

    // Verify mutation is now synced again AND send was called a second time
    const queuedAfterRestart = await clientDriver.run({
      query: 'SELECT server_timestamp_ms FROM _db_mutations_queue',
      params: [],
    })
    expect(queuedAfterRestart).toHaveLength(1)
    expect(queuedAfterRestart[0].server_timestamp_ms).toBeGreaterThan(0)
    // This is the key assertion: send was called AGAIN after restart
    expect(sendCount).toBe(2)

    // Verify server still has the user (should only have 1, not 2)
    const serverUsers = await serverDb.users.select().execute()
    expect(serverUsers).toHaveLength(1)
    expect(serverUsers).toMatchObject([{ name: 'Alice' }])
  })
})
