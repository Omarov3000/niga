import { ulid } from 'ulidx'
import { describe, it, vi, expect } from 'vitest'
import { o } from '../../schema/builder'
import { createFetchWrapper } from '../fetch-wrapper'
import { RemoteDbClient } from '../remote-db'
import { _makeHttpRemoteDb, UnstableNetworkFetch, _makeClientDb } from '../test-helpers'
import { AlwaysOnlineDetector } from '../test-online-detector'
import { DbMutationBatch } from '../types'
import { OrmNodeDriver } from '../../orm-node-driver'

describe('network instability', () => {
  it('retries pull when network fails initially', async () => {
    vi.useFakeTimers()

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
    const wrappedFetch = createFetchWrapper(unstableNetwork.fetch.bind(unstableNetwork), detector)
    const remoteDb = new RemoteDbClient(wrappedFetch)

    const clientPromise = _makeClientDb({ users }, remoteDb, {
      skipPull: false,
      onlineDetector: detector,
      debugName: 'client1'
    })

    await vi.runAllTimersAsync()

    const { db } = await clientPromise

    const result = await db.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice' },
      { name: 'Bob' },
    ])

    vi.useRealTimers()
  })

  it('retries getting latest mutations when network fails', async () => {
    vi.useFakeTimers()

    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    // Setup: server with mutations already in the mutations queue
    const { db: serverDb, server, remoteDb: serverRemoteDb } = await _makeHttpRemoteDb({ users })

    // Directly insert data into server (bypassing sync)
    await serverDb.users.insertMany([
      { name: 'Alice' },
      { name: 'Bob' },
    ])

    // Create a mutation batch on the server side
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

    // Send mutation to server's queue
    await serverRemoteDb.send([batch])

    // Now create unstable network for client
    const unstableNetwork = new UnstableNetworkFetch(server, {
      failPattern: [0, 0, 1], // Fail twice, succeed third time
    })

    const detector = new AlwaysOnlineDetector()
    const wrappedFetch = createFetchWrapper(unstableNetwork.fetch.bind(unstableNetwork), detector)
    const remoteDb = new RemoteDbClient(wrappedFetch)

    // Client initializes - pull will fail/retry, then get() will fail/retry
    const clientPromise = _makeClientDb({ users }, remoteDb, {
      skipPull: false,
      onlineDetector: detector,
      debugName: 'client1'
    })

    await vi.runAllTimersAsync()

    const { db } = await clientPromise

    // Verify client received the data through retried get()
    const result = await db.users.select().execute()
    expect(result).toHaveLength(2)
    expect(result).toMatchObject([
      { name: 'Alice' },
      { name: 'Bob' },
    ])

    vi.useRealTimers()
  })

  it('resumes sending queued mutations after restart', async () => {
    vi.useFakeTimers()
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    const { db: serverDb, server } = await _makeHttpRemoteDb({ users }, { includeSyncTables: true })
    const clientDriver = new OrmNodeDriver()

    // Phase 1: Create client with stable network, make mutation, it succeeds
    const detector1 = new AlwaysOnlineDetector()
    const fetch1 = createFetchWrapper(
      async (url, options) => server.handleRequest(url, options.method || 'GET', options.body as string | undefined),
      detector1
    )
    const remoteDb1 = new RemoteDbClient(fetch1)

    const client1 = await o.syncedDb({
      schema: { users },
      driver: clientDriver,
      remoteDb: remoteDb1,
      skipPull: true,
      onlineDetector: detector1,
      debugName: 'client1'
    })

    // Make a mutation that will be sent successfully
    const insertPromise = client1.users.insertWithUndo({ name: 'Alice' })
    await vi.runAllTimersAsync()
    await insertPromise
    await vi.runAllTimersAsync()

    // Verify it was synced
    let queued1 = await clientDriver.run({
      query: 'SELECT server_timestamp_ms FROM _db_mutations_queue',
      params: [],
    })
    expect(queued1).toHaveLength(1)
    expect(queued1[0].server_timestamp_ms).toBeGreaterThan(0)

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

    // Phase 2: Simulate restart with new remoteDb (same server)
    const detector2 = new AlwaysOnlineDetector()
    const fetch2 = createFetchWrapper(
      async (url, options) => server.handleRequest(url, options.method || 'GET', options.body as string | undefined),
      detector2
    )
    const remoteDb2 = new RemoteDbClient(fetch2)

    // Create new synced-db instance - should retry sending the queued mutation
    const client2 = await o.syncedDb({
      schema: { users },
      driver: clientDriver, // Reuse same driver
      remoteDb: remoteDb2,
      skipPull: true,
      onlineDetector: detector2,
      debugName: 'client1-restarted'
    })

    // Verify mutation is now synced again
    const queuedAfterRestart = await clientDriver.run({
      query: 'SELECT server_timestamp_ms FROM _db_mutations_queue',
      params: [],
    })
    expect(queuedAfterRestart).toHaveLength(1)
    expect(queuedAfterRestart[0].server_timestamp_ms).toBeGreaterThan(0)

    // Verify server still has the user (should only have 1, not 2)
    const serverUsers = await serverDb.users.select().execute()
    expect(serverUsers).toHaveLength(1)
    expect(serverUsers).toMatchObject([{ name: 'Alice' }])

    vi.useRealTimers()
  })
})
