import type { PrismaClientInstance, PrismaTransactionClient } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';
import { buildSearchFilter, omitUndefined } from '@/shared/utils/filtering.util';
import { buildOrderBy } from '@/shared/utils/sorting.util';
import type { PaginatedResult, PaginationParams, SortOrder } from '@/shared/types/list-query.type';
import type {
  ExpenseListFilters,
  ExpenseRecord,
  CreateExpenseData,
  UpdateExpenseData,
} from '@/modules/expense/expense.types';

/** Sortable fields, whitelisted. Also consumed by expense.schema.ts. */
export const EXPENSE_SORT_FIELDS = [
  'title',
  'description',
  'amount',
  'date',
  'categoryId',
  'userId',
  'createdAt',
  'updatedAt',
] as const;

export type ExpenseSortField = (typeof EXPENSE_SORT_FIELDS)[number];

const EXPENSE_SEARCH_FIELDS = ['title', 'description', 'categoryId', 'userId'] as const;

export class ExpenseRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  private buildWhere(filters: ExpenseListFilters) {
    return {
      ...omitUndefined({
        // no equality filters — add one per field that needs it
      }),
      ...buildSearchFilter(EXPENSE_SEARCH_FIELDS, filters.search),
    };
  }

  async findById(id: string, tx?: PrismaTransactionClient): Promise<ExpenseRecord | null> {
    return withPrismaErrors('Expense', () => this.client(tx).expense.findUnique({ where: { id } }));
  }

  async findMany(
    filters: ExpenseListFilters,
    pagination: PaginationParams,
    sortBy?: string,
    sortOrder: SortOrder = 'desc',
  ): Promise<PaginatedResult<ExpenseRecord>> {
    const where = this.buildWhere(filters);
    const orderBy = buildOrderBy(EXPENSE_SORT_FIELDS, 'createdAt', sortBy, sortOrder);

    return withPrismaErrors('Expense', async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.expense.findMany({
          where,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.expense.count({ where }),
      ]);

      return { items, total };
    });
  }

  async count(filters: ExpenseListFilters = {}): Promise<number> {
    return withPrismaErrors('Expense', () => this.prisma.expense.count({ where: this.buildWhere(filters) }));
  }

  async create(data: CreateExpenseData, tx?: PrismaTransactionClient): Promise<ExpenseRecord> {
    return withPrismaErrors('Expense', () =>
      this.client(tx).expense.create({
        data: {
          title: data.title,
          ...(data.description === undefined ? {} : { description: data.description }),
          amount: data.amount,
          date: data.date,
          categoryId: data.categoryId,
          userId: data.userId,
        },
      }),
    );
  }

  async update(id: string, data: UpdateExpenseData, tx?: PrismaTransactionClient): Promise<ExpenseRecord> {
    return withPrismaErrors('Expense', () =>
      this.client(tx).expense.update({
        where: { id },
        data: omitUndefined({
          title: data.title,
          description: data.description,
          amount: data.amount,
          date: data.date,
          categoryId: data.categoryId,
          userId: data.userId,
        }),
      }),
    );
  }

  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    await withPrismaErrors('Expense', () => this.client(tx).expense.delete({ where: { id } }));
  }
}
