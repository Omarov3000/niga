import { describe, it, expect } from 'vitest';
import { b } from './builder';
import { BinNodeDriver } from './bin-node-driver';
import type { Table } from './table';
import { ColumnMutationNotSupportedError, type PreparedSnapshot, type TableSnapshot } from './types';

const runScenario = async (
  steps: Array<{
    schema: Record<string, Table<any, any>>;
    assert: (prepared: PreparedSnapshot) => void;
  }>
) => {
  const driverForSql = new BinNodeDriver(':memory:');
  let previous: TableSnapshot[] | undefined;

  for (const step of steps) {
    const dbInstance = b.db({ name: 'bin_test', schema: step.schema });
    const prepared = dbInstance._prepareSnapshot(previous);
    step.assert(prepared);
    if (prepared.migration.sql) {
      await driverForSql.exec(prepared.migration.sql);
    }
    previous = prepared.snapshot;
  }

  return driverForSql;
};

const buildUsersBase = () => b.table('users', { id: b.id(), name: b.text() });
const buildUsersWithAge = () => b.table('users', { id: b.id(), name: b.text(), age: b.integer() });
const buildUsersRenamedColumns = () => b.table('users', {
  id: b.id(),
  fullName: b.text().renamedFrom('name'),
  age: b.integer(),
});
const buildUsersNoAge = () => b.table('users', { id: b.id(), fullName: b.text() });
const buildUsersWithIndex = () => b.table('users', { id: b.id(), fullName: b.text() }, (t) => [b.index().on(t.fullName)]);
const buildPeopleFromUsers = () => b.table('people', { id: b.id(), fullName: b.text() }).renamedFrom('users');
const buildLogsWithGenerated = () => b.table('logs', {
  id: b.id(),
  title: b.text(),
  titleUpper: b.text().generatedAlwaysAs('upper(title)'),
});

describe('snapshot and migration', () => {
  it('captures table creation and repeated snapshots', async () => {
    await runScenario([
      {
        schema: { users: buildUsersBase() },
        assert: (prepared) => {
          expect(prepared.hasChanges).toBe(true);
          expect(prepared.migration.sql).toMatch(/CREATE TABLE users/);
        },
      },
      {
        schema: { users: buildUsersBase() },
        assert: (prepared) => {
          expect(prepared.hasChanges).toBe(false);
          expect(prepared.migration.sql).toBe('');
        },
      },
    ]);
  });

  it('tracks column and index mutations', async () => {
    await runScenario([
      {
        schema: { users: buildUsersBase() },
        assert: () => {},
      },
      {
        schema: { users: buildUsersWithAge() },
        assert: (prepared) => {
          expect(prepared.migration.sql).toContain('ALTER TABLE users ADD COLUMN age INTEGER;');
        },
      },
      {
        schema: { users: buildUsersRenamedColumns() },
        assert: (prepared) => {
          expect(prepared.migration.sql).toContain('ALTER TABLE users RENAME COLUMN name TO full_name;');
        },
      },
      {
        schema: { users: buildUsersNoAge() },
        assert: (prepared) => {
          expect(prepared.migration.sql).toContain('ALTER TABLE users DROP COLUMN age;');
        },
      },
      {
        schema: { users: buildUsersWithIndex() },
        assert: (prepared) => {
          expect(prepared.migration.sql).toContain('CREATE INDEX users_full_name_idx ON users(full_name);');
        },
      },
      {
        schema: { users: buildUsersNoAge() },
        assert: (prepared) => {
          expect(prepared.migration.sql).toContain('DROP INDEX users_full_name_idx;');
        },
      },
    ]);
  });

  it('handles table rename, drops, and generated columns', async () => {
    const driver = await runScenario([
      {
        schema: { users: buildUsersBase() },
        assert: () => {},
      },
      {
        schema: { people: buildPeopleFromUsers() },
        assert: (prepared) => {
          expect(prepared.migration.sql).toContain('ALTER TABLE users RENAME TO people;');
        },
      },
      {
        schema: {},
        assert: (prepared) => {
          expect(prepared.migration.sql).toContain('DROP TABLE people;');
        },
      },
      {
        schema: { logs: buildLogsWithGenerated() },
        assert: (prepared) => {
          expect(prepared.migration.sql).toContain('CREATE TABLE logs');
          expect(prepared.migration.sql).toContain('GENERATED ALWAYS AS (upper(title)) VIRTUAL');
        },
      },
    ]);

    const tables = await driver.run({
      query: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      params: [],
    });
    expect(tables).toMatchObject([{ name: 'logs' }]);
  });

  it('throws ColumnMutationNotSupportedError on incompatible column changes', () => {
    const baseDb = b.db({
      name: 'bin_test',
      schema: { users: b.table('users', { id: b.id(), name: b.text() }) },
    });
    const baseSnapshot = baseDb._prepareSnapshot();

    const mutatedDb = b.db({
      name: 'bin_test',
      schema: { users: b.table('users', { id: b.id(), name: b.integer() }) },
    });

    expect(() => mutatedDb._prepareSnapshot(baseSnapshot.snapshot)).toThrow(ColumnMutationNotSupportedError);
  });
});
