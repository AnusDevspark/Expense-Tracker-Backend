import { z } from 'zod';
import {
  paginationSchema,
  searchSchema,
  sortingSchema,
  uuidParamSchema,
} from '@/shared/validation/common.schema';
import { EXPENSE_SORT_FIELDS } from '@/modules/expense/expense.repository';

export const expenseIdParamSchema = uuidParamSchema;

const isoDateTimeSchema = z.iso
  .datetime({ offset: true, message: 'must be an ISO-8601 date-time, e.g. 2026-03-01T09:00:00Z' })
  .transform((value) => new Date(value));

export const listExpensesQuerySchema = paginationSchema
  .extend(sortingSchema(EXPENSE_SORT_FIELDS, 'createdAt').shape)
  .extend(searchSchema.shape)
  .extend({
    // add per-field filters here as the model grows
  });

export const createExpenseSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  amount: z.number(),
  date: isoDateTimeSchema,
  categoryId: z.string(),
  accountId: z.string(),
});

export const updateExpenseSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    amount: z.number().optional(),
    date: isoDateTimeSchema.optional(),
    categoryId: z.string().optional(),
    accountId: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });

export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ExpenseIdParam = z.infer<typeof expenseIdParamSchema>;
