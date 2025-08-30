import { b } from './builder';

// Test to understand the type inference
const users = b.table('users', {
  id: b.id(),
  name: b.text().notNull(),
  email: b.text()
});

// This should show us the actual types
type UserInsertType = typeof users.__insertionType__;
type UserSelectType = typeof users.__selectionType__;

// Let's also check the column types directly
type IdColumn = typeof users.id;
type IdColumnMeta = typeof users.id.__meta__;

console.log('ID column meta:', users.id.__meta__);

export type TestTypes = {
  UserInsertType: UserInsertType;
  UserSelectType: UserSelectType;
  IdColumn: IdColumn;
};