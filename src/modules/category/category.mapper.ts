import type { CategoryRecord, CategoryResponse } from '@/modules/category/category.types';

/**
 * Entity -> DTO, field by field. Never `return { ...category }` — that would
 * leak the next internal column someone adds to the table.
 */
export function mapCategoryToResponse(category: CategoryRecord): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    userId: category.userId,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function mapCategoriesToResponse(categorys: CategoryRecord[]): CategoryResponse[] {
  return categorys.map(mapCategoryToResponse);
}
