import { ForbiddenError, NotFoundError } from '@/errors';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { RbacService } from '@/modules/rbac/rbac.service';
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
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly rbacService: RbacService,
  ) {}

  async listCategories(query: ListCategoriesQuery, actor: AuthenticatedUser): Promise<PaginatedCategories> {
    const pagination = getPagination(query);
    const canViewAny = await this.rbacService.hasPermission(actor.role, PERMISSIONS.CATEGORY_VIEW);

    const { items, total } = await this.categoryRepository.findMany(
      {
        search: query.search,
        type: query.type,
        ...(canViewAny ? {} : { userId: actor.id }),
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

  async getCategoryById(id: string, actor: AuthenticatedUser): Promise<CategoryResponse> {
    const category = await this.categoryRepository.findById(id);
    if (!category) throw new NotFoundError('Category not found');

    const isSelf = actor.id === category.userId;
    const canViewAny = await this.rbacService.hasPermission(actor.role, PERMISSIONS.CATEGORY_VIEW);
    if (!isSelf && !canViewAny) {
      throw new ForbiddenError('You can only view your own categories');
    }

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

    const isSelf = actor.id === existing.userId;
    const canEditAny = await this.rbacService.hasPermission(actor.role, PERMISSIONS.CATEGORY_EDIT);
    if (!isSelf && !canEditAny) {
      throw new ForbiddenError('You can only modify your own categories');
    }

    const updated = await this.categoryRepository.update(id, {
      name: input.name,
      type: input.type,
      icon: input.icon,
    });

    return mapCategoryToResponse(updated);
  }

  async deleteCategory(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.categoryRepository.findById(id);
    if (!existing) throw new NotFoundError('Category not found');

    const isSelf = actor.id === existing.userId;
    const canDeleteAny = await this.rbacService.hasPermission(actor.role, PERMISSIONS.CATEGORY_DELETE);
    if (!isSelf && !canDeleteAny) {
      throw new ForbiddenError('You can only delete your own categories');
    }

    await this.categoryRepository.delete(id);
  }
}
