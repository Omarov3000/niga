import { describe, it, expect, beforeEach } from 'vitest'
import { BinD1Driver } from './bin-d1-driver'
import { env } from 'cloudflare:test'

beforeEach(async () => {
  const db = env.testD1
    const result = await db.exec('SELECT 1')
    console.log(result)
})

describe('BinD1Driver', () => {
  it('should be defined', async () => {

  })
})
