export interface DbInsertMutation {
  table: string
  type: 'insert'
  data: Record<string, any>[]

  undo: {
    type: 'delete'
    ids: string[]
  }
}

export interface DbUpdateMutation {
  table: string
  type: 'update'
  data: Record<string, any> // must contain id column

  undo: {
    type: 'update'
    data: Record<string, any>[] // original data with ids
  }
}

export interface DbDeleteMutation {
  table: string
  type: 'delete'
  ids: string[]

  undo: {
    type: 'insert'
    data: Record<string, any>[]
  }
}

export type DbMutation = DbInsertMutation | DbUpdateMutation | DbDeleteMutation

export interface DbMutationBatch {
  id: string // ulid from ulidx
  dbName: string
  mutation: DbMutation[] // batch is a transaction
  node: {
    id: string
    name: string // eg macos
  }
}

export interface OnlineDetector {
  online: boolean
  onOnlineChange: (callback: (online: boolean) => void) => void
}
