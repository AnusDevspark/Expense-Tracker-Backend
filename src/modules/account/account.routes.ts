import { Router, type RequestHandler } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { AccountController } from '@/modules/account/account.controller';
import {
  createAccountSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
  accountIdParamSchema,
} from '@/modules/account/account.schema';

export interface AccountRouteDependencies {
  controller: AccountController;
  authenticate: RequestHandler;
  requirePermission: (...permissions: string[]) => RequestHandler;
}

export function createAccountRouter({ controller, authenticate, requirePermission }: AccountRouteDependencies): Router {
  const router = Router();

  router.use(authenticate);

  router.get(
    '/',
    requirePermission(PERMISSIONS.ACCOUNT_VIEW),
    validate({ query: listAccountsQuerySchema }),
    controller.listAccounts,
  );

  router.post(
    '/',
    requirePermission(PERMISSIONS.ACCOUNT_CREATE),
    validate({ body: createAccountSchema }),
    controller.createAccount,
  );

  router.get(
    '/:id',
    requirePermission(PERMISSIONS.ACCOUNT_VIEW),
    validate({ params: accountIdParamSchema }),
    controller.getAccount,
  );

  router.patch(
    '/:id',
    requirePermission(PERMISSIONS.ACCOUNT_EDIT),
    validate({ params: accountIdParamSchema, body: updateAccountSchema }),
    controller.updateAccount,
  );

  router.delete(
    '/:id',
    requirePermission(PERMISSIONS.ACCOUNT_DELETE),
    validate({ params: accountIdParamSchema }),
    controller.deleteAccount,
  );

  return router;
}
