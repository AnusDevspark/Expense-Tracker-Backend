import type { CategoryType } from '@/generated/prisma/enums';

/**
 * Types the category module exposes to the rest of the application.
 *
 * Hand-written rather than re-exported Prisma types, so a column added to the
 * table later cannot silently appear in a response by accident.
 */

/** What the API returns. */
export interface CategoryResponse {
  id: string;
  name: string;
  type: CategoryType;
  icon?: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

/** The database record, as the repository returns it. */
export interface CategoryRecord {
  id: string;
  name: string;
  type: CategoryType;
  icon?: string | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Whitelisted create fields, built by the service. */
export interface CreateCategoryData {
  name: string;
  type: CategoryType;
  icon?: string;
  userId: string;
}

/** Whitelisted update fields. */
export interface UpdateCategoryData {
  name?: string;
  type?: CategoryType;
  icon?: string;
  userId?: string;
}

/** Whitelisted filters. */
export interface CategoryListFilters {
  search?: string;
  type?: CategoryType;
}
