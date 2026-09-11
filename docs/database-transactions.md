# Database transactions

How to make several writes succeed or fail together. This is not a new
architecture — it is the layering in `AGENTS.md` (`service → repository →
Prisma`) applied to the case where a service needs more than one write.

---

## When to use a transaction

Whenever a single business operation requires two or more writes that must
either all succeed or all fail. Examples:

- Create an order + create its order items
- Create an expense + adjust the related account's balance
- Create a payment + update an invoice's status
- Delete a transaction + restore the balance it had reduced
- Transfer money between two accounts (debit one, credit the other)
- Create a user + create related onboarding records

The template's own examples are `AuthService.changePassword` and
`AuthService.confirmPasswordReset` — see below.

## When NOT to use a transaction

A single write is already atomic. Don't wrap it:

```ts
// No transaction needed — one statement, already atomic.
await userRepository.update(id, data);
```

Same for a read that doesn't gate a write, and for anything that would hold a
transaction open across an HTTP call, a file upload, or an email send —
never do I/O other than the database inside `$transaction`. `AuthService.register`
deliberately does *not* wrap its verification email send: sending mail is
best-effort and must never roll back the user row it just created.

## Transaction ownership

**The service layer owns the transaction boundary.** A transaction represents
a complete business operation, and the service method is what defines "the
operation" — a controller only knows about HTTP, and a repository only knows
about one table.

```text
Controller             — unaware Prisma transactions exist
   ↓
Service                — opens prisma.$transaction, calls 1+ repositories
   ↓
Repository A, B, …     — each just runs its query against whatever client it's given
   ↓
Prisma
```

A repository must never open a transaction and call another repository from
inside it — that would make one table's persistence code respons­ible for
another table's writes, which is a business decision, not a database-access
one.

## Repository transaction support

Every repository method that a service might need inside a transaction takes
an **optional trailing `tx` parameter** instead of a separate
`createWithTransaction`-style method. This is already how every repository in
the template is written — copy the pattern, don't reinvent it:

```ts
// src/database/prisma.ts
export type PrismaTransactionClient = Omit<
  PrismaClientInstance,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
```

```ts
// any repository, e.g. user.repository.ts
export class UserRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  async update(id: string, data: UpdateUserData, tx?: PrismaTransactionClient) {
    return withPrismaErrors('User', () =>
      this.client(tx).user.update({ where: { id }, data }),
    );
  }
}
```

`PrismaTransactionClient` is the shape both a plain `PrismaClient` and the
`tx` handed to a `$transaction` callback satisfy — the method body never
branches on which one it got. Called without `tx`, it runs against the pool
as normal; called with `tx`, it joins the caller's transaction. Same method,
same signature, no duplication.

## The worked example

`AuthService.changePassword` (`src/modules/auth/auth.service.ts`) rewrites a
user's password and revokes their other sessions in one transaction:

```ts
await this.prisma.$transaction(async (tx) => {
  await this.userRepository.update(userId, { passwordHash }, tx);
  await this.authRepository.revokeAllForUser(
    userId,
    exceptSessionId ? { exceptSessionId } : {},
    tx,
  );
});
```

`AuthService.confirmPasswordReset` is the same shape across three
repositories (user, session, verification token). Both are real,
already-shipped code — read them rather than a hypothetical Expense/Account
example, since this template has no business domain of its own.

If you are adding your own module and need the same shape:

```ts
async createExpense(userId: string, input: CreateExpenseInput) {
  return this.prisma.$transaction(async (tx) => {
    const expense = await this.expenseRepository.create({ ...input, userId }, tx);
    await this.accountRepository.adjustBalance(input.accountId, input.amount, tx);
    return expense;
  });
}
```

## Rollback behaviour

**Throwing from the `$transaction` callback rolls back every write made
through the `tx` client passed to that callback.** That is the entire
mechanism:

```text
Expense INSERT succeeds (via tx)
Account UPDATE throws
        ↓
prisma.$transaction rejects
        ↓
Postgres rolls back the transaction
        ↓
the Expense INSERT is undone too
```

Do not catch an error inside the callback and continue — that commits
whatever ran before the catch. Let it throw.

This also means the existing Prisma error wrapper needs no changes to work
inside a transaction. `withPrismaErrors` (`src/shared/utils/prisma-error-mapper.util.ts`)
never swallows: it maps a Prisma error to an `AppError` and rethrows, or
passes an existing `AppError` through unchanged. Either way the callback still
throws, `$transaction` still rejects, and the global error handler still
formats the final result — nothing in that chain has an opportunity to
swallow the error and let a partial transaction commit.

One rule specific to transactions: **pass `tx` to every repository call
inside the callback.** A call that omits it runs against the pool outside the
transaction, commits immediately, and will not roll back with the rest.

`tests/integration/database-transaction.integration.test.ts` proves this
against real Postgres: a successful callback commits both writes, a callback
that throws after both writes leaves neither persisted, and the same
repository method still works with no `tx` at all.

## Nested-service guidance

A service method that opens a transaction must not call another service
method that opens its own, independent transaction, when both writes are
supposed to be atomic. Each `prisma.$transaction` call is its own
transaction — nesting them this way does not make the outer one cover the
inner one, it just runs two unrelated transactions, and a failure in the
second no longer rolls back the first.

```text
# Wrong — two independent transactions, not one atomic operation
ExpenseService.createExpense
    ↓
ExpenseRepository.create                (own connection/tx)
    ↓
AccountService.adjustBalance
    ↓
AccountRepository.updateBalance         (a *different* transaction)
```

```text
# Right — one transaction, one service orchestrating repositories directly
ExpenseService.createExpense
    ↓
prisma.$transaction
    ↓
ExpenseRepository.create
AccountRepository.updateBalance
```

If the operation genuinely needs another module's persistence, inject that
module's **repository** into the service that owns the transaction — the way
`AuthService` is given `UserRepository` directly — rather than calling
through the other module's service. Reserve calling another service for
cases that are genuinely independent operations (their own transaction, if
any) and are allowed to succeed or fail separately.

## Future modules

The same shape — service opens `prisma.$transaction`, injects the
repositories it needs, passes `tx` to every call inside — is what you'll
reach for when adding things like audit logs, notifications, orders,
payments, inventory, wallets, ledger entries, or subscriptions. Nothing here
is specific to auth or users; it's the general pattern for "one business
operation, several writes."
