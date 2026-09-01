import { Router, type RequestHandler } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { CategoryController } from '@/modules/category/category.controller';
import {
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
  categoryIdParamSchema,
} from '@/modules/category/category.schema';

export interface CategoryRouteDependencies {
  controller: CategoryController;
  authenticate: RequestHandler;
  requirePermission: (...permissions: string[]) => RequestHandler;
}

export function createCategoryRouter({ controller, authenticate, requirePermission }: CategoryRouteDependencies): Router {
  const router = Router();

  router.use(authenticate);

  router.get(
    '/',
    requirePermission(PERMISSIONS.CATEGORY_VIEW),
    validate({ query: listCategoriesQuerySchema }),
    controller.listCategories,
  );

  router.post(
    '/',
    requirePermission(PERMISSIONS.CATEGORY_CREATE),
    validate({ body: createCategorySchema }),
    controller.createCategory,
  );

  router.get(
    '/:id',
    requirePermission(PERMISSIONS.CATEGORY_VIEW),
    validate({ params: categoryIdParamSchema }),
    controller.getCategory,
  );

  router.patch(
    '/:id',
    requirePermission(PERMISSIONS.CATEGORY_EDIT),
    validate({ params: categoryIdParamSchema, body: updateCategorySchema }),
    controller.updateCategory,
  );

  router.delete(
    '/:id',
    requirePermission(PERMISSIONS.CATEGORY_DELETE),
    validate({ params: categoryIdParamSchema }),
    controller.deleteCategory,
  );

  return router;
}
