```ts
it('selects many', () => {
  const users = db.users.select().execute()
  type Expected = { id: string, name: string }[]
  type _test = Expect<Equal<typeof users, Expected>>
})

it('selects partial with alias', () => {
  const users = db.users.select({ columns: { userId: db.users.id }}).executeAndTakeFirst()
  type Expected = { userId: string }
  type _test = Expect<Equal<typeof users, Expected>>
})

it('selects with where', () => {
  const users = db.users.select({ where: db.users.id.eq('1') }).execute()
})

it('selects with order by', () => {
  const users = db.users.select({ orderBy: db.users.id.asc() }).execute()
})

it('selects with limit and offset', () => {
  const users = db.users.select({ limit: 10, offset: 10 }).execute()
})

it('selects with group by', () => {
  const users = db.users.select({
    columns: { age: db.users.age, count: db.users.id.count() },
    groupBy: db.users.age
  }).execute()

  type Expected = {
    age: number;
    count: number;
  }[];
  type _test = Expect<Equal<typeof users, Expected>>
})

it('joins', () => {
  const usersWithPets = db.users.select().join(db.pets, db.users.id.eq(db.pets.ownerId)).execute()
  type Expected = {
    user: {
        id: number;
        name: string;
    };
    pets: {
        id: number;
        name: string;
        ownerId: number;
    };
  }[];
  type _test = Expect<Equal<typeof usersWithPets, Expected>>
})

it('joins with flat return type', () => {
  const usersWithPets = db.users.select({
    columns: {
      id: db.users.id,
      petId: db.pets.id,
    }
  }).join(db.pets, db.users.id.eq(db.pets.ownerId)).execute()
  type Expected = {
    id: string;
    petId: string;
  }[];
  type _test = Expect<Equal<typeof usersWithPets, Expected>>
})

it('self join', () => {
  const parent = db.users.as('parent')
  const usersWithParent = db.users.select().leftJoin(parent, db.users.id.eq(parent.parentId)).execute()
  type Expected = {
    users: { id: string; name: string };
    parent: { id: string; name: string; parentId: string };
  }[];
  type _test = Expect<Equal<typeof usersWithParent, Expected>>
})
```
