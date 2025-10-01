import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import { runSharedOrmDriverTests } from '@w/orm/run-shared-orm-driver-tests'
import { OrmD1Driver } from './orm-d1-driver'

const {driver, clearRef} = runSharedOrmDriverTests(() => new OrmD1Driver(env.testD1), { skipTableCleanup: true }) // apparently d1 removes tables between tests (otherwise we get table doesn't exist error)
