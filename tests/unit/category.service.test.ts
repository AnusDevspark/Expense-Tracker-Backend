import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, NotFoundError } from '@/errors';
import { CategoryService } from '@/modules/category/category.service';
import type { CategoryRecord } from '@/modules/category/category.types';
import type { CreateCategoryInput } from '@/modules/category/category.schema';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

/**
 * Business rule covered here: ownership is absolute. A caller may only ever
 * act on their own categories — there is no permission that bypasses this.
 * See AGENTS.md and category.service.ts's doc comment.
 */

function createMockRepository() {
  return {
    findById: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function makeCategoryRecord(overrides: Partial<CategoryRecord> = {}): CategoryRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Sample name',
    type: 'INCOME',
    icon: 'Sample icon',
    userId: '22222222-2222-4222-8222-222222222222',
    createdAt: new Date('2026-01-02T03:04:05.678Z'),
    updatedAt: new Date('2026-01-02T03:04:05.678Z'),
    ...overrides,
  };
}

const owner: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'owner@example.com',
  role: 'USER',
};

const stranger: AuthenticatedUser = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'stranger@example.com',
  role: 'USER',
};

const sampleInput: CreateCategoryInput = {
  name: 'Sample name',
  type: 'INCOME',
  icon: 'Sample icon',
};

describe('CategoryService', () => {
  let repository: ReturnType<typeof createMockRepository>;
  let service: CategoryService;

  beforeEach(() => {
    repository = createMockRepository();
    service = new CategoryService(repository as never);
  });

  describe('getCategoryById', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.getCategoryById('missing-id', owner)).rejects.toThrow(NotFoundError);
    });

    it('returns the mapped record for its owner', async () => {
      repository.findById.mockResolvedValue(makeCategoryRecord());
      const result = await service.getCategoryById('11111111-1111-4111-8111-111111111111', owner);
      expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('throws ForbiddenError for a non-owner', async () => {
      repository.findById.mockResolvedValue(makeCategoryRecord());
      await expect(
        service.getCategoryById('11111111-1111-4111-8111-111111111111', stranger),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('createCategory', () => {
    it('writes exactly the whitelisted fields', async () => {
      repository.create.mockResolvedValue(makeCategoryRecord());
      await service.createCategory(sampleInput, owner);
      expect(repository.create).toHaveBeenCalledWith({ ...sampleInput, userId: owner.id });
    });
  });

  describe('updateCategory', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.updateCategory('missing-id', sampleInput, owner)).rejects.toThrow(NotFoundError);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('writes exactly the whitelisted fields for its owner, without reassigning userId', async () => {
      repository.findById.mockResolvedValue(makeCategoryRecord());
      repository.update.mockResolvedValue(makeCategoryRecord());
      await service.updateCategory('11111111-1111-4111-8111-111111111111', sampleInput, owner);
      expect(repository.update).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', sampleInput);
    });

    it('throws ForbiddenError for a non-owner', async () => {
      repository.findById.mockResolvedValue(makeCategoryRecord());
      await expect(
        service.updateCategory('11111111-1111-4111-8111-111111111111', sampleInput, stranger),
      ).rejects.toThrow(ForbiddenError);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteCategory', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.deleteCategory('missing-id', owner)).rejects.toThrow(NotFoundError);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('deletes when the actor owns the record', async () => {
      repository.findById.mockResolvedValue(makeCategoryRecord());
      await service.deleteCategory('11111111-1111-4111-8111-111111111111', owner);
      expect(repository.delete).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    });

    it('throws ForbiddenError for a non-owner', async () => {
      repository.findById.mockResolvedValue(makeCategoryRecord());
      await expect(
        service.deleteCategory('11111111-1111-4111-8111-111111111111', stranger),
      ).rejects.toThrow(ForbiddenError);
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe('listCategories', () => {
    it('always scopes the query to the actor', async () => {
      repository.findMany.mockResolvedValue({ items: [makeCategoryRecord()], total: 1 });
      await service.listCategories({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' }, stranger);
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: stranger.id }),
        expect.anything(),
        'createdAt',
        'desc',
      );
    });

    it('returns paginated items with meta', async () => {
      repository.findMany.mockResolvedValue({ items: [makeCategoryRecord()], total: 1 });
      const result = await service.listCategories(
        { page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' },
        owner,
      );
      expect(result.categorys).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
