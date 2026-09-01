import type { PrismaClientInstance, PrismaTransactionClient } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';
import { buildSearchFilter, omitUndefined } from '@/shared/utils/filtering.util';
import { buildOrderBy } from '@/shared/utils/sorting.util';
import type { PaginatedResult, PaginationParams, SortOrder } from '@/shared/types/list-query.type';
import type {
  CategoryListFilters,
  CategoryRecord,
  CreateCategoryData,
  UpdateCategoryData,
} from '@/modules/category/category.types';

/** Sortable fields, whitelisted. Also consumed by category.schema.ts. */
export const CATEGORY_SORT_FIELDS = [
  'name',
  'type',
  'icon',
  'createdAt',
  'updatedAt',
] as const;

export type CategorySortField = (typeof CATEGORY_SORT_FIELDS)[number];

const CATEGORY_SEARCH_FIELDS = ['name', 'icon'] as const;

export class CategoryRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  private buildWhere(filters: CategoryListFilters) {
    return {
      ...omitUndefined({
        type: filters.type,
        userId: filters.userId,
      }),
      ...buildSearchFilter(CATEGORY_SEARCH_FIELDS, filters.search),
    };
  }

  async findById(id: string, tx?: PrismaTransactionClient): Promise<CategoryRecord | null> {
    return withPrismaErrors('Category', () => this.client(tx).category.findUnique({ where: { id } }));
  }

  async findMany(
    filters: CategoryListFilters,
    pagination: PaginationParams,
    sortBy?: string,
    sortOrder: SortOrder = 'desc',
  ): Promise<PaginatedResult<CategoryRecord>> {
    const where = this.buildWhere(filters);
    const orderBy = buildOrderBy(CATEGORY_SORT_FIELDS, 'createdAt', sortBy, sortOrder);

    return withPrismaErrors('Category', async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.category.findMany({
          where,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.category.count({ where }),
      ]);

      return { items, total };
    });
  }

  async count(filters: CategoryListFilters = {}): Promise<number> {
    return withPrismaErrors('Category', () => this.prisma.category.count({ where: this.buildWhere(filters) }));
  }

  async create(data: CreateCategoryData, tx?: PrismaTransactionClient): Promise<CategoryRecord> {
    return withPrismaErrors('Category', () =>
      this.client(tx).category.create({
        data: {
          name: data.name,
          type: data.type,
          ...(data.icon === undefined ? {} : { icon: data.icon }),
          userId: data.userId,
        },
      }),
    );
  }

  async update(id: string, data: UpdateCategoryData, tx?: PrismaTransactionClient): Promise<CategoryRecord> {
    return withPrismaErrors('Category', () =>
      this.client(tx).category.update({
        where: { id },
        data: omitUndefined({
          name: data.name,
          type: data.type,
          icon: data.icon,
        }),
      }),
    );
  }

  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    await withPrismaErrors('Category', () => this.client(tx).category.delete({ where: { id } }));
  }
}
