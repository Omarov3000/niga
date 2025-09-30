import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import { runSharedBinDriverTests } from '@w/bin/run-shared-bin-driver-tests'
import { BinD1Driver } from './bin-d1-driver'

const {driver, clearRef} = runSharedBinDriverTests(() => new BinD1Driver(env.testD1), { skipTableCleanup: true }) // apparently d1 removes tables between tests (otherwise we get table doesn't exist error)
