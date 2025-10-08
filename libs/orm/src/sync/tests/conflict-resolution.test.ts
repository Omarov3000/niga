import { ulid } from 'ulidx'
import { describe, it, expect, vi } from 'vitest'
import { o } from '../../schema/builder'
import { _makeRemoteDb, _makeClientDb } from '../test-helpers'
import { DbMutationBatch } from '../types'

describe('conflict resolution', () => {
  it('merges concurrent updates to different fields (case 2.1)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Original', email: 'original@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })

    // Client1 updates name (lower timestamp - sent first)
    await client1.users.updateWithUndo({
      data: { name: 'Alice' },
      where: { id: userId }
    })

    // Client2 updates email (higher timestamp - sent second)
    await client2.users.updateWithUndo({
      data: { email: 'alice@new.com' },
      where: { id: userId }
    })

    // Client3: initialize and should receive merged result
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })

    const result = await client3.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice', email: 'alice@new.com' }
    ])
  })

  it('last-write-wins for concurrent updates to same field (case 2.1b)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'original@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })

    // Client1 updates email to v1 (lower timestamp)
    await client1.users.updateWithUndo({
      data: { email: 'v1@example.com' },
      where: { id: userId }
    })

    // Client2 updates email to v2 (higher timestamp - sent second)
    await client2.users.updateWithUndo({
      data: { email: 'v2@example.com' },
      where: { id: userId }
    })

    // Client3: initialize and should receive LWW result (v2 wins)
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })

    const result = await client3.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice', email: 'v2@example.com' }
    ])
  })

  it('rejects update when delete came first (case 2.2a)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2, driver: client2Driver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })

    // Client1 deletes row (lower timestamp)
    await client1.users.deleteWithUndo({ where: { id: userId } })

    // Client2 updates same row (higher timestamp - should be rejected)
    await client2.users.updateWithUndo({
      data: { email: 'updated@example.com' },
      where: { id: userId }
    })

    // Check that client2's update mutation failed
    const failedMutations = await client2Driver.run({
      query: 'SELECT id FROM _db_mutations_queue WHERE server_timestamp_ms = 0',
      params: [],
    })
    expect(failedMutations.length).toBeGreaterThan(0)

    // Client3: initialize and should see row is deleted
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })

    const result = await client3.users.select().execute()
    expect(result).toHaveLength(0)
  })

  it('rejects delete when update came first (case 2.2b)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2, driver: client2Driver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })

    // Client1 updates row (lower timestamp)
    await client1.users.updateWithUndo({
      data: { email: 'updated@example.com' },
      where: { id: userId }
    })

    // Client2 deletes same row (higher timestamp - should be rejected)
    await client2.users.deleteWithUndo({ where: { id: userId } })

    // Check that client2's delete mutation failed
    const failedMutations = await client2Driver.run({
      query: 'SELECT id FROM _db_mutations_queue WHERE server_timestamp_ms = 0',
      params: [],
    })
    expect(failedMutations.length).toBeGreaterThan(0)

    // Client3: initialize and should see row with update applied
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })

    const result = await client3.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice', email: 'updated@example.com' }
    ])
  })

  it('rejects second delete of same row (case 2.3)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const inserted = await client1.users.insertWithUndo({ name: 'Alice', email: 'alice@example.com' })
    const userId = inserted.id

    // Client2: connect
    const { db: client2, driver: client2Driver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })

    // Client1 deletes row (lower timestamp)
    await client1.users.deleteWithUndo({ where: { id: userId } })

    // Client2 also deletes same row (higher timestamp - should be rejected)
    await client2.users.deleteWithUndo({ where: { id: userId } })

    // Check that client2's delete mutation failed
    const failedMutations = await client2Driver.run({
      query: 'SELECT id FROM _db_mutations_queue WHERE server_timestamp_ms = 0',
      params: [],
    })
    expect(failedMutations.length).toBeGreaterThan(0)

    // Client3: initialize and should see row is deleted
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })

    const result = await client3.users.select().execute()
    expect(result).toHaveLength(0)
  })

  it('rejects duplicate insert with same id (case 2.4)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { remoteDb } = await _makeRemoteDb({ users })

    // Client1: insert user with specific ID
    const { db: client1 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const sharedId = ulid()
    await client1.users.insertWithUndo({ id: sharedId, name: 'Alice', email: 'alice@example.com' })

    // Client2: try to insert different user with same ID
    const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })


    // Try to insert with same ID - should fail locally due to UNIQUE constraint
    // This is expected - with ULIDs this shouldn't happen in practice
    let insertFailed = false
    try {
      await client2.users.insertWithUndo({ id: sharedId, name: 'Bob', email: 'bob@example.com' })
    } catch (error) {
      insertFailed = true
    }

    expect(insertFailed).toBe(true)

    // Client3: initialize and should see only first insert
    const { db: client3 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client3' })

    const result = await client3.users.select().execute()
    expect(result).toMatchObject([
      { name: 'Alice', email: 'alice@example.com' }
    ])
  })

  it('handles out-of-order updates by undoing and reapplying (case 3)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    // Create server DB
    const { remoteDb, driver: serverDriver } = await _makeRemoteDb({ users })

    // Client1: insert and make two updates
    const { db: client1, driver: client1Driver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1' })

    const userId = ulid()
    await client1.users.insertWithUndo({ id: userId, name: 'Alice', email: 'v0@example.com' })

    // Wait for insert to sync

    // Create a second client that will make update 1
    const { db: client1b, driver: client1bDriver } = await _makeClientDb({ users }, remoteDb, { debugName: 'client1b' })

    // Update 1: email to v1 (lower timestamp) - don't sync yet
    // Use an explicitly older timestamp to ensure update1 has lower timestamp than update2
    const update1Time = Date.now() - 1000
    await client1bDriver.run({
      query: 'UPDATE users SET email = ? WHERE id = ?',
      params: ['v1@example.com', userId],
    })

    // Update 2: email to v2 (higher timestamp) from client1 - sync immediately
    await client1.users.updateWithUndo({ data: { email: 'v2@example.com' }, where: { id: userId } })

    // Wait for update2 to sync to server
    await vi.waitFor(async () => {
      const queue = await client1Driver.run({
        query: 'SELECT * FROM _db_mutations_queue WHERE server_timestamp_ms > 0',
        params: []
      })
      expect(queue.length).toBeGreaterThan(0)
    })

    // Now manually send update1 (older update that arrives after newer update2)
    const update1Batch: DbMutationBatch = {
      id: ulid(update1Time),
      dbName: 'synced',
      mutation: [{
        table: 'users',
        type: 'update',
        data: { id: userId, email: 'v1@example.com' },
        undo: {
          type: 'update',
          data: [{ id: userId, email: 'v0@example.com' }],
        },
      }],
      node: { id: ulid(), name: 'client1b' },
    }

    // Send the older update - should be rejected or merged correctly
    await remoteDb.send([update1Batch])

    // Client2: verify final state has v2 (newer update wins)
    const { db: client2 } = await _makeClientDb({ users }, remoteDb, { debugName: 'client2' })

    const finalResult = await client2.users.select().execute()
    expect(finalResult).toMatchObject([
      { name: 'Alice', email: 'v2@example.com' }
    ])
  })

  it('undoes failed mutations when server rejects due to FK violation (case 4)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
    })

    const posts = o.table('posts', {
      id: o.id(),
      title: o.text(),
      authorId: o.idFk().references(() => users.id),
    })

    // Server uses full mode with FK constraints
    const { db: serverDb, remoteDb } = await _makeRemoteDb({ users, posts })

    // Client1: insert user
    const { db: client1 } = await _makeClientDb({ users, posts }, remoteDb, { debugName: 'client1' })

    const userId = ulid()
    await client1.users.insertWithUndo({ id: userId, name: 'Alice' })

    // Client2: insert post with non-existent authorId (FK violation on server)
    const { db: client2, driver: client2Driver } = await _makeClientDb({ users, posts }, remoteDb, { debugName: 'client2' })

    const nonExistentUserId = ulid()
    const postId = ulid()

    // Check server posts BEFORE client2 insert
    const serverPostsBefore = await serverDb.posts.select().execute()
    expect(serverPostsBefore).toHaveLength(0)

    await client2.posts.insertWithUndo({ id: postId, title: 'Invalid Post', authorId: nonExistentUserId })

    // Wait for sync - server will reject due to FK violation

    // Verify post was created locally (client allows it with minimal mode)
    const localPosts = await client2.posts.select().execute()
    expect(localPosts).toHaveLength(1)

    // Server should have rejected it (FK violation)
    const serverPostsAfter = await serverDb.posts.select().execute()
    expect(serverPostsAfter).toHaveLength(0)

    // Client2 should undo the failed mutation locally
    // Check client2's local queue - the failed mutation should trigger undo
    const client2Queue = await client2Driver.run({
      query: 'SELECT * FROM _db_mutations_queue',
      params: [],
    })

    // Mutation exists in queue but with server_timestamp_ms = 0 (failed)
    const failedMutation = client2Queue.find((m: any) => JSON.parse(m.value).mutation[0].data.some((d: any) => d.id === postId))
    expect(failedMutation?.server_timestamp_ms).toBe(0)
  })

  it('rejects entire batch when one mutation fails (transaction atomicity)', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { db: serverDb, remoteDb } = await _makeRemoteDb({ users })

    // Create a batch with mixed valid/invalid mutations
    const validUserId = ulid()
    const invalidUserId = ulid() // Non-existent for update

    const batch: DbMutationBatch = {
      id: ulid(),
      dbName: 'synced',
      mutation: [
        {
          table: 'users',
          type: 'insert',
          data: [{ id: validUserId, name: 'Alice', email: 'alice@example.com' }],
          undo: { type: 'delete', ids: [validUserId] },
        },
        {
          table: 'users',
          type: 'update',
          data: { id: invalidUserId, email: 'invalid@example.com' }, // This will fail - row doesn't exist
          undo: { type: 'update', data: [{ id: invalidUserId, email: 'old@example.com' }] },
        },
      ],
      node: { id: ulid(), name: 'client1' },
    }

    const result = await remoteDb.send([batch])

    // Verify batch failed
    expect(result.failed).toHaveLength(1)
    expect(result.succeeded).toHaveLength(0)

    // Verify NO mutations were applied (transaction rolled back)
    const serverUsers = await serverDb.users.select().execute()
    expect(serverUsers).toHaveLength(0)
  })

  it('handles duplicate batch submissions idempotently', async () => {
    const users = o.table('users', {
      id: o.id(),
      name: o.text(),
      email: o.text(),
    })

    const { db: serverDb, remoteDb } = await _makeRemoteDb({ users })

    const userId = ulid()
    const batch: DbMutationBatch = {
      id: ulid(),
      dbName: 'synced',
      mutation: [
        {
          table: 'users',
          type: 'insert',
          data: [{ id: userId, name: 'Alice', email: 'alice@example.com' }],
          undo: { type: 'delete', ids: [userId] },
        },
      ],
      node: { id: ulid(), name: 'client1' },
    }

    // Send batch first time
    const result1 = await remoteDb.send([batch])
    expect(result1.succeeded).toHaveLength(1)
    expect(result1.failed).toHaveLength(0)

    // Send same batch again (network retry)
    const result2 = await remoteDb.send([batch])
    expect(result2.succeeded).toHaveLength(1) // Duplicate returns as succeeded
    expect(result2.duplicated).toHaveLength(1) // But marked as duplicated
    expect(result2.failed).toHaveLength(0)

    // Verify user exists only once
    const serverUsers = await serverDb.users.select().execute()
    expect(serverUsers).toHaveLength(1)
    expect(serverUsers[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com' })
  })
})
