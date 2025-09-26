import { describe, it, expect } from 'vitest';
import { runSharedBinDriverTests } from './run-shared-bin-driver-tests';
import { BinNodeDriver } from './bin-node-driver';
import { b } from './builder';

const {driverRef, clearRef} = runSharedBinDriverTests(() => new BinNodeDriver(':memory:'));
