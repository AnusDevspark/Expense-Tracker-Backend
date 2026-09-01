import { NotFoundError } from '@/errors';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { CategoryRepository } from '@/modules/category/category.repository';
import { mapCategoriesToResponse, mapCategoryToResponse } from '@/modules/category/category.mapper';
import type { CategoryResponse } from '@/modules/category/category.types';
import type { CreateCategoryInput, ListCategoriesQuery, UpdateCategoryInput } from '@/modules/category/category.schema';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

export interface PaginatedCategories {
  categorys: CategoryResponse[];
  meta: PaginationMeta;
}

/**
 * Category business rules. No Express here — no Request, no Response, no
 * status codes — which is what makes this unit-testable against a mocked
 * repository. Add ownership/authorization rules at the top of the relevant
 * method, not in middleware, per AGENTS.md.
 */
export class CategoryService {
  constructor(private readonly categoryRepository: CategoryRepository) {}

  async listCategories(query: ListCategoriesQuery): Promise<PaginatedCategories> {
    const pagination = getPagination(query);

    const { items, total } = await this.categoryRepository.findMany(
      {
        search: query.search,
        type: query.type,
      },
      pagination,
      query.sortBy,
      query.sortOrder,
    );

    return {
      categorys: mapCategoriesToResponse(items),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async getCategoryById(id: string): Promise<CategoryResponse> {
    const category = await this.categoryRepository.findById(id);
    if (!category) throw new NotFoundError('Category not found');
    return mapCategoryToResponse(category);
  }

  async createCategory(input: CreateCategoryInput, actor: AuthenticatedUser): Promise<CategoryResponse> {
    const category = await this.categoryRepository.create({
      name: input.name,
      type: input.type,
      icon: input.icon,
      userId: actor.id,
    });

    return mapCategoryToResponse(category);
  }

  async updateCategory(id: string, input: UpdateCategoryInput, actor: AuthenticatedUser): Promise<CategoryResponse> {
    const existing = await this.categoryRepository.findById(id);
    if (!existing) throw new NotFoundError('Category not found');

    const updated = await this.categoryRepository.update(id, {
      name: input.name,
      type: input.type,
      icon: input.icon,
      userId: actor.id,
    });

    return mapCategoryToResponse(updated);
  }

  async deleteCategory(id: string): Promise<void> {
    const existing = await this.categoryRepository.findById(id);
    if (!existing) throw new NotFoundError('Category not found');
    await this.categoryRepository.delete(id);
  }
}
