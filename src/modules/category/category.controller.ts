import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/shared/response/send-response.util';
import type { CategoryService } from '@/modules/category/category.service';
import type {
  CategoryIdParam,
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from '@/modules/category/category.schema';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  listCategories = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListCategoriesQuery;
    const { categorys, meta } = await this.categoryService.listCategories(query);
    sendPaginated(res, categorys, meta);
  };

  getCategory = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as CategoryIdParam;
    const category = await this.categoryService.getCategoryById(id);
    sendSuccess(res, category);
  };

  createCategory = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as CreateCategoryInput;
    const actor = req.user as AuthenticatedUser;
    const category = await this.categoryService.createCategory(input, actor);
    sendCreated(res, category, 'Category created successfully.');
  };

  updateCategory = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as CategoryIdParam;
    const input = req.body as UpdateCategoryInput;
    const actor = req.user as AuthenticatedUser;
    const category = await this.categoryService.updateCategory(id, input, actor);
    sendSuccess(res, category, 'Category updated successfully.');
  };

  deleteCategory = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as CategoryIdParam;
    await this.categoryService.deleteCategory(id);
    sendNoContent(res);
  };
}
