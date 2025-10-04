import { initTRPC } from '@trpc/server';
import { db } from './db';

const t = initTRPC.create();

const router = t.router;
const publicProcedure = t.procedure;

const appRouter = router({
  userList: publicProcedure
    .query(async (opts) => {
      const users = await db.users.select().execute();
      return users;
    }),
});

type AppRouter = typeof appRouter;

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000',
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient: {} as any,
});

const users = await trpcClient.userList.query();

const userOptions = trpc.userList.queryOptions()
