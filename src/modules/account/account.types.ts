import type { Prisma } from '@/generated/prisma/client';

/**
 * Types the account module exposes to the rest of the application.
 *
 * Hand-written rather than re-exported Prisma types, so a column added to the
 * table later cannot silently appear in a response by accident.
 */

/** What the API returns. */
export interface AccountResponse {
  id: string;
  name: string;
  initalBalance: number;
  balance: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

/** The database record, as the repository returns it. */
export interface AccountRecord {
  id: string;
  name: string;
  initalBalance: Prisma.Decimal;
  balance: Prisma.Decimal;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Whitelisted create fields, built by the service. */
export interface CreateAccountData {
  name: string;
  initalBalance: number;
  balance: number;
  userId: string;
}

/** Whitelisted update fields. */
export interface UpdateAccountData {
  name?: string;
  initalBalance?: number;
  balance?: number;
}

/** Whitelisted filters. */
export interface AccountListFilters {
  search?: string;
  userId?: string;
}
