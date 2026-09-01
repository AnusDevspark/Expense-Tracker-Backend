import { ForbiddenError, NotFoundError } from '@/errors';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { RbacService } from '@/modules/rbac/rbac.service';
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
  constructor(
    private readonly expenseRepository: ExpenseRepository,
    private readonly rbacService: RbacService,
  ) {}

  async listExpenses(query: ListExpensesQuery, actor: AuthenticatedUser): Promise<PaginatedExpenses> {
    const pagination = getPagination(query);
    const canViewAny = await this.rbacService.hasPermission(actor.role, PERMISSIONS.EXPENSE_VIEW);

    const { items, total } = await this.expenseRepository.findMany(
      {
        search: query.search,
        ...(canViewAny ? {} : { userId: actor.id }),
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

    const isSelf = actor.id === expense.userId;
    const canViewAny = await this.rbacService.hasPermission(actor.role, PERMISSIONS.EXPENSE_VIEW);
    if (!isSelf && !canViewAny) {
      throw new ForbiddenError('You can only view your own expenses');
    }

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

    const isSelf = actor.id === existing.userId;
    const canEditAny = await this.rbacService.hasPermission(actor.role, PERMISSIONS.EXPENSE_EDIT);
    if (!isSelf && !canEditAny) {
      throw new ForbiddenError('You can only modify your own expenses');
    }

    const updated = await this.expenseRepository.update(id, {
      title: input.title,
      description: input.description,
      amount: input.amount,
      date: input.date,
      categoryId: input.categoryId,
    });

    return mapExpenseToResponse(updated);
  }

  async deleteExpense(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.expenseRepository.findById(id);
    if (!existing) throw new NotFoundError('Expense not found');

    const isSelf = actor.id === existing.userId;
    const canDeleteAny = await this.rbacService.hasPermission(actor.role, PERMISSIONS.EXPENSE_DELETE);
    if (!isSelf && !canDeleteAny) {
      throw new ForbiddenError('You can only delete your own expenses');
    }

    await this.expenseRepository.delete(id);
  }
}
