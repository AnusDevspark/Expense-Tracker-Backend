import type { PrismaClientInstance } from '@/database/prisma';
import { ForbiddenError, NotFoundError } from '@/errors';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { ExpenseRepository } from '@/modules/expense/expense.repository';
import { mapExpensesToResponse, mapExpenseToResponse } from '@/modules/expense/expense.mapper';
import type { ExpenseResponse } from '@/modules/expense/expense.types';
import type { CreateExpenseInput, ListExpensesQuery, UpdateExpenseInput } from '@/modules/expense/expense.schema';
import type { AccountRepository } from '@/modules/account/account.repository';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

export interface PaginatedExpenses {
  expenses: ExpenseResponse[];
  meta: PaginationMeta;
}

/**
 * Expense business rules. No Express here — no Request, no Response, no
 * status codes — which is what makes this unit-testable against a mocked
 * repository.
 *
 * Ownership is absolute: an expense belongs to exactly the user who created
 * it, with no permission that bypasses that — EXPENSE_VIEW/EDIT/DELETE only
 * gate whether a role can use the feature at all (enforced at the route),
 * never whose records it can touch. See AGENTS.md and
 * permissions.constant.ts's note on the USER role's default grants.
 */
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaClientInstance,
    private readonly expenseRepository: ExpenseRepository,
    private readonly accountRepository: AccountRepository,
  ) {}

  async listExpenses(query: ListExpensesQuery, actor: AuthenticatedUser): Promise<PaginatedExpenses> {
    const pagination = getPagination(query);

    const { items, total } = await this.expenseRepository.findMany(
      {
        search: query.search,
        userId: actor.id,
      },
      pagination,
      query.sortBy,
      query.sortOrder,
    );

    return {
      expenses: mapExpensesToResponse(items),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async getExpenseById(id: string, actor: AuthenticatedUser): Promise<ExpenseResponse> {
    const expense = await this.expenseRepository.findById(id);
    if (!expense) throw new NotFoundError('Expense not found');

    if (expense.userId !== actor.id) {
      throw new ForbiddenError('You can only view your own expenses');
    }

    return mapExpenseToResponse(expense);
  }

  async createExpense(input: CreateExpenseInput, actor: AuthenticatedUser): Promise<ExpenseResponse> {
    const account = await this.accountRepository.findById(input.accountId);
    if (!account) throw new NotFoundError('Account not found');
    if (account.userId !== actor.id) {
      throw new ForbiddenError('You can only spend from your own accounts');
    }

    const expense = await this.prisma.$transaction(async (tx) => {
      const created = await this.expenseRepository.create(
        {
          title: input.title,
          description: input.description,
          amount: input.amount,
          date: input.date,
          categoryId: input.categoryId,
          accountId: input.accountId,
          userId: actor.id,
        },
        tx,
      );

      await this.accountRepository.adjustBalance(input.accountId, -input.amount, tx);

      return created;
    });

    return mapExpenseToResponse(expense);
  }

  async updateExpense(id: string, input: UpdateExpenseInput, actor: AuthenticatedUser): Promise<ExpenseResponse> {
    const existing = await this.expenseRepository.findById(id);
    if (!existing) throw new NotFoundError('Expense not found');

    if (existing.userId !== actor.id) {
      throw new ForbiddenError('You can only modify your own expenses');
    }

    const nextAccountId = input.accountId ?? existing.accountId;
    if (input.accountId && input.accountId !== existing.accountId) {
      const nextAccount = await this.accountRepository.findById(input.accountId);
      if (!nextAccount) throw new NotFoundError('Account not found');
      if (nextAccount.userId !== actor.id) {
        throw new ForbiddenError('You can only spend from your own accounts');
      }
    }

    const previousAmount = existing.amount.toNumber();
    const nextAmount = input.amount ?? previousAmount;
    const balanceChanged = nextAccountId !== existing.accountId || nextAmount !== previousAmount;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.expenseRepository.update(
        id,
        {
          title: input.title,
          description: input.description,
          amount: input.amount,
          date: input.date,
          categoryId: input.categoryId,
          accountId: input.accountId,
        },
        tx,
      );

      if (balanceChanged) {
        await this.accountRepository.adjustBalance(existing.accountId, previousAmount, tx);
        await this.accountRepository.adjustBalance(nextAccountId, -nextAmount, tx);
      }

      return result;
    });

    return mapExpenseToResponse(updated);
  }

  async deleteExpense(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.expenseRepository.findById(id);
    if (!existing) throw new NotFoundError('Expense not found');

    if (existing.userId !== actor.id) {
      throw new ForbiddenError('You can only delete your own expenses');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.expenseRepository.delete(id, tx);
      await this.accountRepository.adjustBalance(existing.accountId, existing.amount.toNumber(), tx);
    });
  }
}
 