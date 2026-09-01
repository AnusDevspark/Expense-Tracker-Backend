import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/shared/response/send-response.util';
import type { ExpenseService } from '@/modules/expense/expense.service';
import type {
  ExpenseIdParam,
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateExpenseInput,
} from '@/modules/expense/expense.schema';
import { requireAuthenticatedUser } from '@/shared/utils/auth-context.util';

export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  listExpenses = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListExpensesQuery;
    const { expenses, meta } = await this.expenseService.listExpenses(query);
    sendPaginated(res, expenses, meta);
  };

  getExpense = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as ExpenseIdParam;
    const expense = await this.expenseService.getExpenseById(id);
    sendSuccess(res, expense);
  };

  createExpense = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as CreateExpenseInput;
    const actor = requireAuthenticatedUser(req);
    const expense = await this.expenseService.createExpense(input, actor);
    sendCreated(res, expense, 'Expense created successfully.');
  };

  updateExpense = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as ExpenseIdParam;
    const input = req.body as UpdateExpenseInput;
    const actor = requireAuthenticatedUser(req);
    const expense = await this.expenseService.updateExpense(id, input, actor);
    sendSuccess(res, expense, 'Expense updated successfully.');
  };

  deleteExpense = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as ExpenseIdParam;
    await this.expenseService.deleteExpense(id);
    sendNoContent(res);
  };
}
