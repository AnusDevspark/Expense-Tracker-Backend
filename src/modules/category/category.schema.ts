import { z } from 'zod';
import { CategoryType } from '@/generated/prisma/enums';

import {
  paginationSchema,
  searchSchema,
  sortingSchema,
  uuidParamSchema,
} from '@/shared/validation/common.schema';
import { CATEGORY_SORT_FIELDS } from '@/modules/category/category.repository';

export const categoryIdParamSchema = uuidParamSchema;

export const listCategoriesQuerySchema = paginationSchema
  .extend(sortingSchema(CATEGORY_SORT_FIELDS, 'createdAt').shape)
  .extend(searchSchema.shape)
  .extend({
    type: z.enum(CategoryType).optional(),
  });

export const createCategorySchema = z.object({
  name: z.string(),
  type: z.enum(CategoryType),
  icon: z.string().optional(),
});

export const updateCategorySchema = z
  .object({
    name: z.string().optional(),
    type: z.enum(CategoryType).optional(),
    icon: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CategoryIdParam = z.infer<typeof categoryIdParamSchema>;
