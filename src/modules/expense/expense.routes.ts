import { Router, type RequestHandler } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { ExpenseController } from '@/modules/expense/expense.controller';
import {
  createExpenseSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
  expenseIdParamSchema,
} from '@/modules/expense/expense.schema';

export interface ExpenseRouteDependencies {
  controller: ExpenseController;
  authenticate: RequestHandler;
  requirePermission: (...permissions: string[]) => RequestHandler;
}

export function createExpenseRouter({ controller, authenticate, requirePermission }: ExpenseRouteDependencies): Router {
  const router = Router();

  router.use(authenticate);

  router.get(
    '/',
    requirePermission(PERMISSIONS.EXPENSE_VIEW),
    validate({ query: listExpensesQuerySchema }),
    controller.listExpenses,
  );

  router.post(
    '/',
    requirePermission(PERMISSIONS.EXPENSE_CREATE),
    validate({ body: createExpenseSchema }),
    controller.createExpense,
  );

  router.get(
    '/:id',
    requirePermission(PERMISSIONS.EXPENSE_VIEW),
    validate({ params: expenseIdParamSchema }),
    controller.getExpense,
  );

  router.patch(
    '/:id',
    requirePermission(PERMISSIONS.EXPENSE_EDIT),
    validate({ params: expenseIdParamSchema, body: updateExpenseSchema }),
    controller.updateExpense,
  );

  router.delete(
    '/:id',
    requirePermission(PERMISSIONS.EXPENSE_DELETE),
    validate({ params: expenseIdParamSchema }),
    controller.deleteExpense,
  );

  return router;
}
