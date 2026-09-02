import type { ExpenseRecord, ExpenseResponse } from '@/modules/expense/expense.types';

/**
 * Entity -> DTO, field by field. Never `return { ...expense }` — that would
 * leak the next internal column someone adds to the table.
 */
export function mapExpenseToResponse(expense: ExpenseRecord): ExpenseResponse {
  return {
    id: expense.id,
    title: expense.title,
    description: expense.description,
    amount: expense.amount.toNumber(),
    date: expense.date.toISOString(),
    categoryId: expense.categoryId,
    categoryName: expense.category.name,
    accountId: expense.accountId,
    accountName: expense.account.name,
    userId: expense.userId,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

export function mapExpensesToResponse(expenses: ExpenseRecord[]): ExpenseResponse[] {
  return expenses.map(mapExpenseToResponse);
}
