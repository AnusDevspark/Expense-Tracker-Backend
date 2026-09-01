import { z } from 'zod';
import {
  paginationSchema,
  searchSchema,
  sortingSchema,
  uuidParamSchema,
} from '@/shared/validation/common.schema';
import { ACCOUNT_SORT_FIELDS } from '@/modules/account/account.repository';

export const accountIdParamSchema = uuidParamSchema;

export const listAccountsQuerySchema = paginationSchema
  .extend(sortingSchema(ACCOUNT_SORT_FIELDS, 'createdAt').shape)
  .extend(searchSchema.shape)
  .extend({
    // add per-field filters here as the model grows
  });

export const createAccountSchema = z.object({
  name: z.string(),
  initalBalance: z.number().default(0),
  balance: z.number(),
});

export const updateAccountSchema = z
  .object({
    name: z.string().optional(),
    initalBalance: z.number().optional(),
    balance: z.number().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });

export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type AccountIdParam = z.infer<typeof accountIdParamSchema>;
