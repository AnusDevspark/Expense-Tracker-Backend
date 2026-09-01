import type { PrismaClientInstance, PrismaTransactionClient } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';
import { buildSearchFilter, omitUndefined } from '@/shared/utils/filtering.util';
import { buildOrderBy } from '@/shared/utils/sorting.util';
import type { PaginatedResult, PaginationParams, SortOrder } from '@/shared/types/list-query.type';
import type {
  AccountListFilters,
  AccountRecord,
  CreateAccountData,
  UpdateAccountData,
} from '@/modules/account/account.types';

/** Sortable fields, whitelisted. Also consumed by account.schema.ts. */
export const ACCOUNT_SORT_FIELDS = [
  'name',
  'initalBalance',
  'balance',
  'userId',
  'createdAt',
  'updatedAt',
] as const;

export type AccountSortField = (typeof ACCOUNT_SORT_FIELDS)[number];

const ACCOUNT_SEARCH_FIELDS = ['name', 'userId'] as const;

export class AccountRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  private buildWhere(filters: AccountListFilters) {
    return {
      ...omitUndefined({
        // no equality filters — add one per field that needs it
      }),
      ...buildSearchFilter(ACCOUNT_SEARCH_FIELDS, filters.search),
    };
  }

  async findById(id: string, tx?: PrismaTransactionClient): Promise<AccountRecord | null> {
    return withPrismaErrors('Account', () => this.client(tx).account.findUnique({ where: { id } }));
  }

  async findMany(
    filters: AccountListFilters,
    pagination: PaginationParams,
    sortBy?: string,
    sortOrder: SortOrder = 'desc',
  ): Promise<PaginatedResult<AccountRecord>> {
    const where = this.buildWhere(filters);
    const orderBy = buildOrderBy(ACCOUNT_SORT_FIELDS, 'createdAt', sortBy, sortOrder);

    return withPrismaErrors('Account', async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.account.findMany({
          where,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.account.count({ where }),
      ]);

      return { items, total };
    });
  }

  async count(filters: AccountListFilters = {}): Promise<number> {
    return withPrismaErrors('Account', () => this.prisma.account.count({ where: this.buildWhere(filters) }));
  }

  async create(data: CreateAccountData, tx?: PrismaTransactionClient): Promise<AccountRecord> {
    return withPrismaErrors('Account', () =>
      this.client(tx).account.create({
        data: {
          name: data.name,
          initalBalance: data.initalBalance,
          balance: data.balance,
          userId: data.userId,
        },
      }),
    );
  }

  async update(id: string, data: UpdateAccountData, tx?: PrismaTransactionClient): Promise<AccountRecord> {
    return withPrismaErrors('Account', () =>
      this.client(tx).account.update({
        where: { id },
        data: omitUndefined({
          name: data.name,
          initalBalance: data.initalBalance,
          balance: data.balance,
          userId: data.userId,
        }),
      }),
    );
  }

  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    await withPrismaErrors('Account', () => this.client(tx).account.delete({ where: { id } }));
  }
}
