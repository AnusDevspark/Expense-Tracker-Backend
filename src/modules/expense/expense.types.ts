import type { Prisma } from '@/generated/prisma/client';

/**
 * Types the expense module exposes to the rest of the application.
 *
 * Hand-written rather than re-exported Prisma types, so a column added to the
 * table later cannot silently appear in a response by accident.
 */

/** What the API returns. */
export interface ExpenseResponse {
  id: string;
  title: string;
  description?: string | null;
  amount: number;
  date: string;
  categoryId: string;
  categoryName: string;
  accountId: string;
  accountName: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

/** The database record, as the repository returns it. */
export interface ExpenseRecord {
  id: string;
  title: string;
  description?: string | null;
  amount: Prisma.Decimal;
  date: Date;
  categoryId: string;
  category: {
    id: string;
    name: string;
  };
  accountId: string;
  account: {
    id: string;
    name: string;
  };
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Whitelisted create fields, built by the service. */
export interface CreateExpenseData {
  title: string;
  description?: string;
  amount: number;
  date: Date;
  categoryId: string;
  accountId: string;
  userId: string;
}

/** Whitelisted update fields. */
export interface UpdateExpenseData {
  title?: string;
  description?: string;
  amount?: number;
  date?: Date;
  categoryId?: string;
  accountId?: string;
}

/** Whitelisted filters. */
export interface ExpenseListFilters {
  search?: string;
  categoryId?: string;
  accountId?: string;
  userId?: string;
}
