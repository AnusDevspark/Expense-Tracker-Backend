import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/shared/response/send-response.util';
import type { AccountService } from '@/modules/account/account.service';
import type {
  AccountIdParam,
  CreateAccountInput,
  ListAccountsQuery,
  UpdateAccountInput,
} from '@/modules/account/account.schema';

export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  listAccounts = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListAccountsQuery;
    const { accounts, meta } = await this.accountService.listAccounts(query);
    sendPaginated(res, accounts, meta);
  };

  getAccount = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AccountIdParam;
    const account = await this.accountService.getAccountById(id);
    sendSuccess(res, account);
  };

  createAccount = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as CreateAccountInput;
    const account = await this.accountService.createAccount(input);
    sendCreated(res, account, 'Account created successfully.');
  };

  updateAccount = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AccountIdParam;
    const input = req.body as UpdateAccountInput;
    const account = await this.accountService.updateAccount(id, input);
    sendSuccess(res, account, 'Account updated successfully.');
  };

  deleteAccount = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AccountIdParam;
    await this.accountService.deleteAccount(id);
    sendNoContent(res);
  };
}
