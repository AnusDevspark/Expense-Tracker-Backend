import type { Request, Response } from 'express';
import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from '@/shared/response/send-response.util';
import type { AccountService } from '@/modules/account/account.service';
import type {
  AccountIdParam,
  CreateAccountInput,
  ListAccountsQuery,
  UpdateAccountInput,
} from '@/modules/account/account.schema';
import { requireAuthenticatedUser } from '@/shared/utils/auth-context.util';

export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  listAccounts = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListAccountsQuery;
    const actor = requireAuthenticatedUser(req);
    const { accounts, meta } = await this.accountService.listAccounts(query, actor);
    sendPaginated(res, accounts, meta);
  };

  getAccount = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AccountIdParam;
    const actor = requireAuthenticatedUser(req);
    const account = await this.accountService.getAccountById(id, actor);
    sendSuccess(res, account);
  };

  createAccount = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as CreateAccountInput;
    const actor = requireAuthenticatedUser(req);
    const account = await this.accountService.createAccount(input, actor);
    sendCreated(res, account, 'Account created successfully.');
  };

  updateAccount = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AccountIdParam;
    const input = req.body as UpdateAccountInput;
    const actor = requireAuthenticatedUser(req);
    const account = await this.accountService.updateAccount(id, input, actor);
    sendSuccess(res, account, 'Account updated successfully.');
  };

  deleteAccount = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AccountIdParam;
    const actor = requireAuthenticatedUser(req);
    await this.accountService.deleteAccount(id, actor);
    sendNoContent(res);
  };
}
