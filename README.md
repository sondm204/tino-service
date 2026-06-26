# tino-service

## Database migrations

Supabase Auth is not used. The Express API owns custom auth, while Supabase is
used as Postgres.

```bash
pnpm db:link
pnpm db:push
```

Create later migrations with a descriptive name:

```bash
pnpm db:migration:new add-expense-tags
```
