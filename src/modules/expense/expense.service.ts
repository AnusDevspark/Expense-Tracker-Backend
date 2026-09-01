import { NotFoundError } from '@/errors';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { ExpenseRepository } from '@/modules/expense/expense.repository';
import { mapExpensesToResponse, mapExpenseToResponse } from '@/modules/expense/expense.mapper';
import type { ExpenseResponse } from '@/modules/expense/expense.types';
import type { CreateExpenseInput, ListExpensesQuery, UpdateExpenseInput } from '@/modules/expense/expense.schema';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

export interface PaginatedExpenses {
  expenses: ExpenseResponse[];
  meta: PaginationMeta;
}

/**
 * Expense business rules. No Express here — no Request, no Response, no
 * status codes — which is what makes this unit-testable against a mocked
 * repository. Add ownership/authorization rules at the top of the relevant
 * method, not in middleware, per AGENTS.md.
 */
export class ExpenseService {
  constructor(private readonly expenseRepository: ExpenseRepository) {}

  async listExpenses(query: ListExpensesQuery): Promise<PaginatedExpenses> {
    const pagination = getPagination(query);

    const { items, total } = await this.expenseRepository.findMany(
      {
        search: query.search,

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

  async getExpenseById(id: string): Promise<ExpenseResponse> {
    const expense = await this.expenseRepository.findById(id);
    if (!expense) throw new NotFoundError('Expense not found');
    return mapExpenseToResponse(expense);
  }

  async createExpense(input: CreateExpenseInput, actor: AuthenticatedUser): Promise<ExpenseResponse> {
    const expense = await this.expenseRepository.create({
      title: input.title,
      description: input.description,
      amount: input.amount,
      date: input.date,
      categoryId: input.categoryId,
      userId: actor.id,
    });

    return mapExpenseToResponse(expense);
  }

  async updateExpense(id: string, input: UpdateExpenseInput, actor: AuthenticatedUser): Promise<ExpenseResponse> {
    const existing = await this.expenseRepository.findById(id);
    if (!existing) throw new NotFoundError('Expense not found');

    const updated = await this.expenseRepository.update(id, {
      title: input.title,
      description: input.description,
      amount: input.amount,
      date: input.date,
      categoryId: input.categoryId,
      userId: actor.id,
    });

    return mapExpenseToResponse(updated);
  }

  async deleteExpense(id: string): Promise<void> {
    const existing = await this.expenseRepository.findById(id);
    if (!existing) throw new NotFoundError('Expense not found');
    await this.expenseRepository.delete(id);
  }
}
