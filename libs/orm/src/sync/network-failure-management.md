# Network Failure Management

## Core Principles

1. **Treat all network failures the same way**: Retry with exponential backoff
2. **Never give up**: Keep retrying indefinitely until network comes back
3. **Exponential backoff**: Avoid overwhelming the server (1s, 2s, 4s, 8s, 16s, then cap at 16s)
4. **Stream interruptions**: Start over from last known offset
5. **Wait for online**: Block all network operations when offline until `detector.waitForOnline()` resolves

## Network Failure Points

### 1. Initial Pull (Streaming Data)
- **When**: Client calls `remoteDb.pull()` to get Arrow-formatted table data
- **What fails**: HTTP stream cuts off mid-transfer
- **Response**: Start over from last committed offset (tracked in `_sync_pull_progress`)
- **State**: Remains in `pulling` until complete

### 2. Getting Latest Mutations
- **When**: Client calls `remoteDb.get(maxTimestamp)` to fetch new mutations
- **What fails**: HTTP request fails or times out
- **Response**: Retry with backoff, use same `maxTimestamp`
- **State**: `gettingLatest` or `synced` (background sync)

### 3. Sending Mutations
- **When**: Client calls `remoteDb.send([batch])` after local mutation
- **What fails**: HTTP POST fails
- **Response**: Keep mutation in queue (server_timestamp_ms = 0), retry on reconnect
- **State**: `synced`

### 4. Proxy Reads (Future)
- **When**: Client queries during `gettingLatest` phase before sync complete
- **What fails**: `remoteDb.query()` fails
- **Response**: Retry with backoff, or fallback to local stale data
- **State**: N/A (not blocking)

## Failure Scenarios

All failure types are treated identically:

- **Transient**: 503, timeout, connection reset → Retry
- **Hard failures**: DNS failure, network unreachable → Mark offline, retry when online
- **Partial failures**: Stream cuts off → Resume from offset
- **Slow network**: Timeout → Retry
- **Intermittent**: Random failures → Retry

## System State Machine

```
pulling → gettingLatest → synced
   ↓            ↓            ↓
   └────────→ offline ←─────┘
                ↓
         (wait for online)
                ↓
         gettingLatest → synced
```

### State Transitions

- **pulling → offline**: Pull fails after retries, wait for `detector.waitForOnline()`
- **gettingLatest → offline**: Initial `get()` fails after retries
- **synced → offline**: Mutation `send()` fails after retries
- **offline → gettingLatest**: `detector.online` becomes true, retry pending operations

## Blocking vs Non-Blocking Initialization

### Current Behavior (Blocking)
```typescript
async initialize() {
  await pullAll()                        // BLOCKS until complete
  await syncMutationsFromServer()        // BLOCKS until initial get() complete
  syncMutationsFromServerInBackground()  // Non-blocking background sync
}
```

### The Problem
- Client is **unusable** until initial sync completes
- If network is slow/offline, initialization hangs indefinitely
- User sees loading spinner forever
- No way to access local data while syncing

### Design Decision Needed

#### Option A: Fully Blocking (Current)
**Pros:**
- Simple mental model
- Guaranteed fresh data
- No stale reads

**Cons:**
- Hangs on slow/offline network
- Poor UX (long waits)
- Can't use app offline-first

```typescript
const db = await syncedDb({ ... })  // Blocks until synced
await db.users.select()              // Always fresh data
```

#### Option B: Non-Blocking Init, Block on First Read
**Pros:**
- Fast initialization
- Reads block until synced (guaranteed fresh)
- Writes work immediately (queue locally)

**Cons:**
- First read might wait unexpectedly
- Complexity: need to track "has synced once"

```typescript
const db = await syncedDb({ ... })   // Returns immediately (pulling/gettingLatest)
await db.users.select()               // BLOCKS until initial sync complete
await db.users.insertWithUndo(...)    // Works immediately, queues
```

#### Option C: Fully Non-Blocking (Offline-First)
**Pros:**
- Instant app start
- Works offline immediately
- Best UX

**Cons:**
- Reads return stale/empty data initially
- Need UI to show sync state
- Complex: race between local read and sync

```typescript
const db = await syncedDb({ ... })   // Returns immediately
await db.users.select()               // Returns local data (might be stale/empty)
db.syncState                          // 'pulling' | 'gettingLatest' | 'synced' | 'offline'
```

### Recommendation: Option B (Non-Blocking Init, Block on First Read)

**Reasoning:**
1. **Fast startup**: App initializes immediately
2. **Data consistency**: First read guarantees fresh data from server
3. **Offline writes**: Can make mutations before sync completes
4. **Progressive enhancement**: Works offline, better when online

**Implementation:**
```typescript
class SyncedDb {
  private initialSyncComplete = false
  private initialSyncPromise: Promise<void>

  async initialize() {
    // Start pull in background (non-blocking)
    this.initialSyncPromise = this.pullAll()
      .then(() => this.syncMutationsFromServer())
      .then(() => { this.initialSyncComplete = true })

    // Return immediately - don't await
  }

  async select() {
    // Block first read until initial sync complete
    if (!this.initialSyncComplete) {
      await this.initialSyncPromise
    }
    return await this.driver.run(...)
  }

  async insertWithUndo() {
    // Writes don't need to wait for sync
    await this.driver.run(...)
    await this.enqueueMutation(...)  // Queues locally
  }
}
```

### Edge Cases

**What if network is offline during init?**
- Option A: Hangs forever (bad UX)
- Option B: First read waits forever (bad UX)
- Option C: Returns empty data, syncs when online (best)

**What if user wants offline-first behavior?**
- Add `skipInitialSync` option
- Or check `detector.online` before waiting

**What if initial sync fails permanently?**
- Never happens (we retry forever)
- But user might want to cancel → need `AbortSignal`

### Questions to Resolve

1. **Should we block reads during initial sync?**
   - Yes → Guarantees fresh data (Option B)
   - No → Better UX but stale reads (Option C)

2. **Should we allow offline-first mode?**
   - If yes → Option C with `skipInitialSync: true`
   - If no → Option B is simpler

3. **What happens to reads during `gettingLatest` after first sync?**
   - Block until latest mutations applied? (consistency)
   - Return local data immediately? (performance)

4. **Should writes block during initial sync?**
   - No (always queue locally)
   - But should we try to send immediately if online?

### Proposed Solution

**Default behavior (Option B with escape hatch):**
```typescript
const db = await syncedDb({
  schema,
  driver,
  remoteDb,
  onlineDetector,
  offlineFirst: false  // NEW: default blocks reads until synced
})

// First read blocks until initial sync
const users = await db.users.select()  // Waits for gettingLatest → synced

// Subsequent reads are immediate (local)
const posts = await db.posts.select()  // Instant

// Writes always work (queue locally)
await db.users.insertWithUndo({ ... })  // Instant
```

**Offline-first mode:**
```typescript
const db = await syncedDb({
  offlineFirst: true  // Reads never block, might be stale
})

// Check sync state in UI
if (db.syncState !== 'synced') {
  showSyncingIndicator()
}
```

## Retry Strategy

### Exponential Backoff
- Attempt 0: immediate
- Attempt 1: 1s delay
- Attempt 2: 2s delay
- Attempt 3: 4s delay
- Attempt 4: 8s delay
- Attempt 5+: 16s delay (capped)

### Never Give Up
- No max retry count for operations
- If offline, wait for `detector.waitForOnline()` before retrying
- Background sync continues retrying indefinitely

### Wrapper Around Fetch
All `remoteDbClient` operations must use:
```typescript
const fetchWrapper: typeof fetch = async (...args) => {
  if (!detector.online) await detector.waitForOnline()
  return fetch(...args)
}
```

## Testing Strategy

### Test Levels
- **High-level integration tests** preferred (full client + server + RemoteDb)
- Test **behavior**, not implementation details
- Use `ControllableOnlineDetector` to simulate offline/online transitions
- Use `UnstableNetworkFetch` to simulate failures

### Critical Test Scenarios

#### 1. Basic Online Operation
- Setup: Server with data, online client
- Action: Client syncs
- Assert: Data appears locally, state = 'synced'

#### 2. Mutation Queue During Offline
- Setup: Client makes mutation, go offline before send completes
- Action: Verify mutation queued locally (server_timestamp_ms = 0)
- Assert: Mutation exists in local queue, not on server

#### 3. Resume After Offline
- Setup: Client offline with queued mutations
- Action: Go online, wait for sync
- Assert: Queued mutations appear on server, state = 'synced'

#### 4. Interrupted Pull Recovery
- Setup: Server with data, simulate stream failure mid-pull
- Action: Pull fails, retry from offset
- Assert: All data eventually synced, no duplicates

#### 5. Multiple Clients With Network Issues
- Setup: Client A and B, flaky network
- Action: Both make mutations with intermittent failures
- Assert: Eventually consistent, all mutations propagated

### Test Anti-Patterns to Avoid

❌ Testing retry count limits (we never give up)
❌ Testing specific backoff timings (implementation detail)
❌ Mocking internal methods (test behavior)
❌ Complex failure patterns that don't reflect reality
❌ Testing every possible network error code separately

### What NOT to Test

- Exact retry delays (as long as it eventually succeeds)
- Internal state transitions (test observable behavior)
- Specific error messages
- Implementation of exponential backoff algorithm
- Number of retries before giving up (infinite)

## Implementation Requirements

### 1. Fetch Wrapper
Create `fetchWithOnlineWait()` that:
- Checks `detector.online`
- Calls `await detector.waitForOnline()` if offline
- Wraps all `RemoteDbClient` fetch calls

### 2. OnlineDetector.waitForOnline()
Already added to interface:
```typescript
interface OnlineDetector {
  online: boolean
  onOnlineChange: (callback: (online: boolean) => void) => void
  waitForOnline: () => Promise<void>  // NEW
}
```

### 3. Retry Logic Updates
- Remove max retry count from `retryWithBackoff`
- Cap backoff at 16s instead of unlimited growth
- Always check online status before each attempt

### 4. Stream Resumption
- `pullAll()` already tracks offsets in `_sync_pull_progress`
- On failure, next pull reads offsets and resumes
- No changes needed (already works)

## Summary

- **Simple**: All failures → retry with backoff
- **Resilient**: Never give up, wait for online
- **Efficient**: Exponential backoff prevents server overload
- **Testable**: High-level behavior tests, not implementation details
- **Pragmatic**: Focus on what matters (eventual consistency), ignore edge cases
