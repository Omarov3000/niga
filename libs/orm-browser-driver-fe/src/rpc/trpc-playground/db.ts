import { o } from '@w/orm';

const users = o.table('users', {
  id: o.id(),
  name: o.text(),
});

export const db = o.db({ schema: { users } });
