import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { Db } from './db';
import type { PreparedSnapshot, TableSnapshot } from './types';

export async function migrate(db: Db): Promise<PreparedSnapshot> {
  const snapshotPath = join(process.cwd(), 'src', `${db.name}.bin.json`);

  let previous: TableSnapshot[] | undefined;
  try {
    const raw = await readFile(snapshotPath, 'utf8');
    previous = JSON.parse(raw) as TableSnapshot[];
  } catch (error: any) {
    if (!error || error.code !== 'ENOENT') throw error;
  }

  const prepared = db._prepareSnapshot(previous);

  if (!prepared.hasChanges) {
    console.info('No changes detected.');
    return prepared;
  }

  const migrationsDir = join(process.cwd(), 'migrations');
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(join(migrationsDir, prepared.migration.name), prepared.migration.sql, 'utf8');

  await mkdir(join(process.cwd(), 'src'), { recursive: true });
  await writeFile(snapshotPath, JSON.stringify(prepared.snapshot, null, 2), 'utf8');
  console.info('Migration has been prepared.');

  return prepared;
}
