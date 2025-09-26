import { describe, it, expect } from 'vitest';
import { runSharedTests } from './make-shared-tests';
import { BinNodeDriver } from './bin-node-driver';
import { b } from './builder';

runSharedTests(() => new BinNodeDriver(':memory:'));

describe('transaction', () => {
  it('rolls back earlier statements when a later statement fails', async () => {
    const driver = new BinNodeDriver(':memory:');
    const users = b.table('users', {
      id: b.id(),
      name: b.text(),
    });

    const db = await b.testDb({ schema: { users } }, driver);

    await expect(
      db.transaction(async (tx) => {
        await tx.users.insert({ id: 'u1', name: 'Alice' });
        // This violates the PRIMARY KEY constraint (duplicate id)
        await tx.users.insert({ id: 'u1', name: 'Duplicate' });
      })
    ).rejects.toThrow();

    const rows = await driver.run({ query: 'SELECT id, name FROM users WHERE id = ?', params: ['u1'] });
    expect(rows).toMatchObject([]);
  });
});
