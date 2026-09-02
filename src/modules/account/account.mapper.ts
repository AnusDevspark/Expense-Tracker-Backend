import type { AccountRecord, AccountResponse } from '@/modules/account/account.types';

/**
 * Entity -> DTO, field by field. Never `return { ...account }` — that would
 * leak the next internal column someone adds to the table.
 */
export function mapAccountToResponse(account: AccountRecord): AccountResponse {
  return {
    id: account.id,
    name: account.name,
    initialBalance: account.initialBalance.toNumber(),
    balance: account.balance.toNumber(),
    userId: account.userId,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function mapAccountsToResponse(accounts: AccountRecord[]): AccountResponse[] {
  return accounts.map(mapAccountToResponse);
}
