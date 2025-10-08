import { describe, it, expect } from 'vitest';
import { OrmNodeDriver } from '../orm-node-driver';
import { o } from './builder';
import { Table } from './table';
import { PreparedSnapshot, TableSnapshot, ColumnMutationNotSupportedError } from './types';

const runScenario = async (
  steps: Array<{
    schema: Record<string, Table<any, any>>;
    assert: (prepared: PreparedSnapshot) => void;
  }>
) => {
  const driverForSql = new OrmNodeDriver();
  let previous: TableSnapshot[] | undefined;

  for (const step of steps) {
    const dbInstance = o.db({ name: 'orm_test', schema: step.schema });
    const prepared = dbInstance._prepareSnapshot(previous);
    step.assert(prepared);
    if (prepared.migration.sql) {
      await driverForSql.exec(prepared.migration.sql);
    }
    previous = prepared.snapshot;
  }

  return driverForSql;
};

const buildUsersBase = () => o.table('users', { id: o.id(), name: o.text() });
const buildUsersWithAge = () => o.table('users', { id: o.id(), name: o.text(), age: o.integer() });
const buildUsersRenamedColumns = () => o.table('users', {
  id: o.id(),
  fullName: o.text().renamedFrom('name'),
  age: o.integer(),
});
const buildUsersNoAge = () => o.table('users', { id: o.id(), fullName: o.text() });
const buildUsersWithIndex = () => o.table('users', { id: o.id(), fullName: o.text() }, (t) => [o.index().on(t.fullName)]);
const buildPeopleFromUsers = () => o.table('people', { id: o.id(), fullName: o.text() }).renamedFrom('users');
const buildLogsWithGenerated = () => o.table('logs', {
  id: o.id(),
  title: o.text(),
  titleUpper: o.text().generatedAlwaysAs('upper(title)'),
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
    const baseDb = o.db({
      name: 'bin_test',
      schema: { users: o.table('users', { id: o.id(), name: o.text() }) },
    });
    const baseSnapshot = baseDb._prepareSnapshot();

    const mutatedDb = o.db({
      name: 'bin_test',
      schema: { users: o.table('users', { id: o.id(), name: o.integer() }) },
    });

    expect(() => mutatedDb._prepareSnapshot(baseSnapshot.snapshot)).toThrow(ColumnMutationNotSupportedError);
  });

  it('captures table constraints in snapshots', async () => {
    const users = o.table(
      'users',
      {
        id: o.text(),
        email: o.text(),
        firstName: o.text(),
        lastName: o.text(),
      },
      undefined,
      (t) => [o.primaryKey(t.id), o.unique(t.email), o.unique(t.firstName, t.lastName)]
    );

    await runScenario([
      {
        schema: { users },
        assert: (prepared) => {
          expect(prepared.hasChanges).toBe(true);
          expect(prepared.migration.sql).toContain('CREATE TABLE users');
          expect(prepared.migration.sql).toContain('PRIMARY KEY (id)');
          expect(prepared.migration.sql).toContain('UNIQUE (email)');
          expect(prepared.migration.sql).toContain('UNIQUE (first_name, last_name)');

          const userSnapshot = prepared.snapshot.find(s => s.name === 'users');
          expect(userSnapshot?.constrains).toMatchObject([
            ['primaryKey', 'id'],
            ['unique', 'email'],
            ['unique', 'first_name', 'last_name']
          ]);
        },
      },
      {
        schema: { users },
        assert: (prepared) => {
          expect(prepared.hasChanges).toBe(false);
          expect(prepared.migration.sql).toBe('');
        },
      },
    ]);
  });

  it('throws error on constraint changes', () => {
    const usersNoConstraints = o.table('users', { id: o.text(), email: o.text() });
    const usersPrimaryKey = o.table('users', { id: o.text(), email: o.text() }, undefined, (t) => [o.primaryKey(t.id)]);

    const db1 = o.db({ schema: { users: usersNoConstraints } });
    const snapshot1 = db1._prepareSnapshot();

    const db2 = o.db({ schema: { users: usersPrimaryKey } });

    expect(() => db2._prepareSnapshot(snapshot1.snapshot))
      .toThrow("Constraint changes are not supported. Table 'users' constraint changes detected.");
  });
});
