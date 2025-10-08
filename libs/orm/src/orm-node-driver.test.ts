import { describe, it, expect } from 'vitest';
import { runSharedOrmDriverTests } from './run-shared-orm-driver-tests';
import { OrmNodeDriver } from './orm-node-driver';
import { o } from './schema/builder';

const {driver, clearRef} = runSharedOrmDriverTests(() => new OrmNodeDriver());
