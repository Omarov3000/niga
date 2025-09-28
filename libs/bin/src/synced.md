we need to implement data syncing between 2 databases using bin orm. It's master-master architecture.

introduce `SyncedTable extends Table`, `SyncedDb extends Db`, `b.syncedDb`

SyncedTable has 3 new methods: `insertWithUndo`, `updateWithUndo`, `deleteWithUndo`. they have the same parameters as their regular counterparts. They produce `DbMutation`.

```ts
type NodeRejectionError = {
  node: string
  time: Date
  message: string
}

interface DbInsertMutation {
  table: string
  type: 'insert'
  data: Record<string, any>[]

  undo: {
    type: 'delete'
    ids: string[]
  }

  rejection?: NodeRejectionError
}

interface DbUpdateMutation {
  table: string
  type: 'update'
  data: Record<string, any>
  where: RawSql

  undo: {
    type: 'update'
    data: Record<string, any>[] // before updating fileds we need to read the original data and save it here (with ids)
  }

  rejection?: NodeRejectionError
}

interface DbDeleteMutation {
  table: string
  type: 'delete'
  ids: string[]

  undo: {
    type: 'insert'
    data: Record<string, any>[]
  }

  rejection?: NodeRejectionError
}

type DbMutation = DbInsertMutation | DbUpdateMutation | DbDeleteMutation

type DbMutationBatch = {
  id: string // ulid from ulidx
  dbName: string
  mutation: DbMutation[] // for batch updates
  appliedLocally?: boolean
}
```

Before applying a mutation locally it needs to be saved to `DbSyncQueue`.

```ts
interface DbSyncQueue {
  put: (mutation: DbMutationBatch) => Promise<void>
  update: (id: string, opts: { appliedLocally?: boolean }) => Promise<void>
  delete: (id: string) => Promise<void>
}
```

After saving it needs to be applied locally. If fails it needs to be removed from the queue. If succeeds it needs to be update in the queue and then sent to the remote database.

```ts
interface RemoteDb {
  send: (batch: DbMutationBatch[]) => Promise<{ failed: string[] }>
  get: (afterId: string) => Promise<DbMutationBatch[]> // afterId is ulid
}
```

If remote database returns `failed` ids we need to apply the undo of the mutations. Then store it in `DbSyncDeadQueue` with failure reason. If applying undo fails we need to indicate it clearly in `DbSyncDeadQueue`. All other ids from the batch needed to be removed from the queue.

SyncedDb holds the SyncQueue and the RemoteDb. It should re-try flushing the queue on start. When remoteDb returns failed it performs undo properly. It also has `acceptSyncBatch` method that accepts `DbMutationBatch[]` and performs synchronization. This method is called by `RemoteDb.send`. On start SyncedDb should call `RemoteDb.get` and apply mutations. If one of the mutations fail we need to create a new reverse mutation with `rejection` and send it to the `RemoteDb.send`.

Both remote and local databases should have table _mutations { id: string, succeededAt: Date } to track the mutations and avoid double application.
