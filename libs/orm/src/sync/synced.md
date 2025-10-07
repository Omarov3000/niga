we need to implement data syncing between client - server with offline support.

introduce `SyncedTable`, `SyncedDb extends Db`, `b.syncedDb`

SyncedTable has same methods as Table but it replaces mutating methods with: `insertWithUndo`, `updateWithUndo`, `deleteWithUndo`. they have the same parameters as their regular counterparts. They produce `DbMutation`.

```ts
interface DbInsertMutation {
  table: string
  type: 'insert'
  data: Record<string, any>[]

  undo: {
    type: 'delete'
    ids: string[]
  }
}

interface DbUpdateMutation {
  table: string
  type: 'update'
  data: Record<string, any> // we should assert that it always contains id column (no arbitrary updates). no increments or other "relative" updates.

  undo: {
    type: 'update'
    data: Record<string, any>[] // before updating fileds we need to read the original data and save it here (with ids)
  }
}

interface DbDeleteMutation {
  table: string
  type: 'delete'
  ids: string[]

  undo: {
    type: 'insert'
    data: Record<string, any>[]
  }
}

type DbMutation = DbInsertMutation | DbUpdateMutation | DbDeleteMutation

type DbMutationBatch = {
  id: string // ulid from ulidx
  dbName: string
  mutation: DbMutation[] // for batch updates. batch is a transaction
  node: {
    id: string
    name: string // eg macos
  }
}
```

```ts
// on client and server
table _db_mutations_queue {
  id: string // ulid
  value: string // DbMutationBatch
  // we don't use server commit sequence number (CSN) and allow server clock drift (which is unlikely)
  server_timestamp_ms: integer // when mutation is applied on server it sets this field. locally it's 0 until it's updated from server (in this case we can set value to '')
}

// on client only
table _db_mutations_queue_dead {}

// on server only: detect conflicts
table _latest_server_timestamp {
  table: string
  row_id: string
  server_timestamp_ms: integer
}
```

After applying mutation and storing it in queue table (in tx) it needs to be sent to the remote database.

```ts
interface RemoteDb {
  send: (batch: DbMutationBatch[]) => Promise<{ succeeded: { id: string; server_timestamp_ms: number }[]; failed: string[] }>
  get: (maxServerTimestampLocally: number) => Promise<DbMutationBatch[]>
  pull: (opts: { required: { table: string; offset?: number }[] }): Promise<Blob> // tableName:(rowsNumber or '' if all table was read) + apache-arrow representation of the rows data. Let's assume that this will be streamed from server but for now we can assume that it's a single blob.
}
```

If remote database returns `failed` ids we need to apply the undo of the mutations. Then store it in `DbSyncDeadQueue` with failure reason. If applying undo fails we need to indicate it clearly in `DbSyncDeadQueue`. All other ids from the batch needed to be removed from the queue.

`DbSyncDeadQueue` is used to communicate errors to users.

`SyncedDb` holds the SyncQueue and the RemoteDb. It should re-try flushing the queue on start. When remoteDb returns failed it performs undo properly. It also has `acceptSyncBatch` method that accepts `DbMutationBatch[]` and performs synchronization. This method is called by `RemoteDb.send`. On start SyncedDb should call `RemoteDb.get` and apply mutations. If it's first start it needs to pull all tables.

In case of network partition we retry send from DbSyncQueue up to 7 days. then it is moved DbSyncDeadQueue. DbSyncDeadQueue is cleared every 2 weeks.

What should be ignored when implementing sync:
1. schema evolution or Schema‑constraint violations

# Conflict Cases & Solutions

If one mutation in the batch is rejected (eg due to conflict) all batch is rejected.

Client might re-try to send the batch. Before handling we should ignore if already applied.

We need to use:
```ts
const ulid = monotonicFactory(); // from ulidx
// Strict ordering for the same timestamp, by incrementing the least-significant random bit by 1
ulid(150000); // 000XAL6S41ACTAV9WEVGEMMVR8
```

to ensure that our mutations are strictly ordered.

## 1. Uniqueness constraints
- **Conflict**: insert or update can lead to uniqueness violation.
- **Solution**: use **ULIDs** as IDs → uniqueness guaranteed → ignore.
- Assumption: no 2 same objects can be inserted.

## 2. Concurrent modification of same row on 2 devices
Total order: sort by `(server_timestamp_ms, id)`

Server vs device drift:
  Device sends mutation, but server already applied a **newer mutation** for that row - reject the older mutation if conflict cannot be resolved.

- **Case 2.1: update vs update**
  - A: updates field(s)
  - B: updates same/different field(s)
  - **Solution**:
    - Different fields → merge them.
    - Same field → later `(server_timestamp_ms, id)` wins (LWW).
    - we use simple merge and we treat arrays as atomic. No CRDT style merging.

- **Case 2.2: update vs delete**
  - A: deletes row
  - B: updates row
  - **Solution**: Reject what comes later.

- **Case 2.3: delete vs delete**
  - Both delete same row
  - **Solution**: Row deleted. One of the deletes is rejected.

- **Case 2.4: insert vs insert**
  - impossible: ids are unique. Reject what comes later.

- **Case 2.5: insert vs delete**
  - A: inserts row
  - B:
    - inserts row
    - deletes row
  - **Solution**: Impossible - ids are unique. Reject what comes later.

## 3. Out of order mutations arrival on server

Problem: Update arrives before insert.

Solution: Network doesn't preserve order. If we see newer mutation (by it's ulid) we should undo the older one and re-apply them.

## 4. Cross‑device causality or Conflict beyond single‑row

Example:

- Device A inserts row X (ts=100).

- Device B doesn’t see it yet and inserts a new row Y referencing X.

- Before A’s insert reaches B, B’s insert Y arrives at server → FK violation.

Solution: enforce constrains server side only. Reject mutations that violate them.



# TODO

@libs/orm/src/sync/synced-db.test.ts you need to remove // authorId is binary data, just verify it exists and properly verify that it is

migrateDb in orm
.clear in synced-db
RemoteDbClient + RemoteDbServer
getLatestMutation should be blocking. we should proxy read / write queries to remote db before local db syncs (if there is network) and queue write mutations for local
integrate synced-db with orm-browser-driver-fe
derived tables
