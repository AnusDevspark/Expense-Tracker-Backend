import { NotFoundError } from '@/errors';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { AccountRepository } from '@/modules/account/account.repository';
import { mapAccountsToResponse, mapAccountToResponse } from '@/modules/account/account.mapper';
import type { AccountResponse } from '@/modules/account/account.types';
import type {
  CreateAccountInput,
  ListAccountsQuery,
  UpdateAccountInput,
} from '@/modules/account/account.schema';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

export interface PaginatedAccounts {
  accounts: AccountResponse[];
  meta: PaginationMeta;
}

/**
 * Account business rules. No Express here — no Request, no Response, no
 * status codes — which is what makes this unit-testable against a mocked
 * repository. Add ownership/authorization rules at the top of the relevant
 * method, not in middleware, per AGENTS.md.
 */
export class AccountService {
  constructor(private readonly accountRepository: AccountRepository) {}

  async listAccounts(
    query: ListAccountsQuery,
    actor: AuthenticatedUser,
  ): Promise<PaginatedAccounts> {
    const pagination = getPagination(query);

    const { items, total } = await this.accountRepository.findMany(
      {
        search: query.search,
        userId: actor.id,
      },
      pagination,
      query.sortBy,
      query.sortOrder,
    );

    return {
      accounts: mapAccountsToResponse(items),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async getAccountById(id: string, actor: AuthenticatedUser): Promise<AccountResponse> {
    const account = await this.accountRepository.findById(id);
    if (!account) throw new NotFoundError('Account not found');

    if (account.userId !== actor.id) {
      throw new NotFoundError('You can only view your own accounts');
    }

    return mapAccountToResponse(account);
  }

  async createAccount(
    input: CreateAccountInput,
    actor: AuthenticatedUser,
  ): Promise<AccountResponse> {
    const account = await this.accountRepository.create({
      name: input.name,
      initalBalance: input.initalBalance,
      balance: input.balance,
      userId: actor.id,
    });

    return mapAccountToResponse(account);
  }

  async updateAccount(
    id: string,
    input: UpdateAccountInput,
    actor: AuthenticatedUser,
  ): Promise<AccountResponse> {
    const existing = await this.accountRepository.findById(id);
    if (!existing) throw new NotFoundError('Account not found');

    if (existing.userId !== actor.id) {
      throw new NotFoundError('You can only update your own accounts');
    }

    const updated = await this.accountRepository.update(id, {
      name: input.name,
      initalBalance: input.initalBalance,
      balance: input.balance,
    });

    return mapAccountToResponse(updated);
  }

  async deleteAccount(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.accountRepository.findById(id);
    if (!existing) throw new NotFoundError('Account not found');

    if (existing.userId !== actor.id) {
      throw new NotFoundError('You can only delete your own accounts');
    }

    await this.accountRepository.delete(id);
  }
}
