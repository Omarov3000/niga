Task: implement transaction support and add tests in bin-node-driver.test.ts.

```ts
await db.transaction(async (tx) => {
  // Create a user
  await tx.users.insert({
    data: { id: 'u1', name: 'Alice' },
  });

  // Create that user’s profile
  await tx.profiles.insert({
    data: { userId: 'u1' },
  });
});
```

main challenge: we need to support d1 database which doesn't support transactions. Instead it accumulates writes in a batch and executes all or discards all.
