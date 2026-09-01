import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { ForbiddenError, NotFoundError } from '@/errors';
import { ExpenseService } from '@/modules/expense/expense.service';
import type { ExpenseRecord } from '@/modules/expense/expense.types';
import type { CreateExpenseInput } from '@/modules/expense/expense.schema';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

/**
 * Business rules covered here: ownership. A caller may always act on their own
 * expenses; acting on someone else's requires the matching permission
 * (EXPENSE_VIEW/EDIT/DELETE doubling as the "any expense" grant), mirroring
 * UserService.updateUser. See AGENTS.md.
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

function createMockRbacService(hasPermission = false) {
  return {
    hasPermission: vi.fn().mockResolvedValue(hasPermission),
  };
}

function makeExpenseRecord(overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Sample title',
    description: 'Sample description',
    amount: new Prisma.Decimal('123.45'),
    date: new Date('2026-01-02T03:04:05.678Z'),
    categoryId: '11111111-1111-4111-8111-111111111111',
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

const sampleInput: CreateExpenseInput = {
  title: 'Sample title',
  description: 'Sample description',
  amount: 123.45,
  date: new Date('2026-01-02T03:04:05.678Z'),
  categoryId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
};

describe('ExpenseService', () => {
  let repository: ReturnType<typeof createMockRepository>;
  let rbacService: ReturnType<typeof createMockRbacService>;
  let service: ExpenseService;

  beforeEach(() => {
    repository = createMockRepository();
    rbacService = createMockRbacService(false);
    service = new ExpenseService(repository as never, rbacService as never);
  });

  describe('getExpenseById', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.getExpenseById('missing-id', owner)).rejects.toThrow(NotFoundError);
    });

    it('returns the mapped record for its owner', async () => {
      repository.findById.mockResolvedValue(makeExpenseRecord());
      const result = await service.getExpenseById('11111111-1111-4111-8111-111111111111', owner);
      expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('throws ForbiddenError for a non-owner without EXPENSE_VIEW', async () => {
      repository.findById.mockResolvedValue(makeExpenseRecord());
      await expect(
        service.getExpenseById('11111111-1111-4111-8111-111111111111', stranger),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows a non-owner holding EXPENSE_VIEW', async () => {
      rbacService.hasPermission.mockResolvedValue(true);
      repository.findById.mockResolvedValue(makeExpenseRecord());
      const result = await service.getExpenseById('11111111-1111-4111-8111-111111111111', stranger);
      expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    });
  });

  describe('createExpense', () => {
    it('writes exactly the whitelisted fields, owned by the actor', async () => {
      repository.create.mockResolvedValue(makeExpenseRecord());
      await service.createExpense(sampleInput, owner);
      expect(repository.create).toHaveBeenCalledWith({
        title: sampleInput.title,
        description: sampleInput.description,
        amount: sampleInput.amount,
        date: sampleInput.date,
        categoryId: sampleInput.categoryId,
        userId: owner.id,
      });
    });
  });

  describe('updateExpense', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.updateExpense('missing-id', sampleInput, owner)).rejects.toThrow(NotFoundError);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('writes exactly the whitelisted fields for its owner, without reassigning userId', async () => {
      repository.findById.mockResolvedValue(makeExpenseRecord());
      repository.update.mockResolvedValue(makeExpenseRecord());
      await service.updateExpense('11111111-1111-4111-8111-111111111111', sampleInput, owner);
      expect(repository.update).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
        title: sampleInput.title,
        description: sampleInput.description,
        amount: sampleInput.amount,
        date: sampleInput.date,
        categoryId: sampleInput.categoryId,
      });
    });

    it('throws ForbiddenError for a non-owner without EXPENSE_EDIT', async () => {
      repository.findById.mockResolvedValue(makeExpenseRecord());
      await expect(
        service.updateExpense('11111111-1111-4111-8111-111111111111', sampleInput, stranger),
      ).rejects.toThrow(ForbiddenError);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('allows a non-owner holding EXPENSE_EDIT', async () => {
      rbacService.hasPermission.mockResolvedValue(true);
      repository.findById.mockResolvedValue(makeExpenseRecord());
      repository.update.mockResolvedValue(makeExpenseRecord());
      const result = await service.updateExpense(
        '11111111-1111-4111-8111-111111111111',
        sampleInput,
        stranger,
      );
      expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    });
  });

  describe('deleteExpense', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.deleteExpense('missing-id', owner)).rejects.toThrow(NotFoundError);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('deletes when the actor owns the record', async () => {
      repository.findById.mockResolvedValue(makeExpenseRecord());
      await service.deleteExpense('11111111-1111-4111-8111-111111111111', owner);
      expect(repository.delete).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    });

    it('throws ForbiddenError for a non-owner without EXPENSE_DELETE', async () => {
      repository.findById.mockResolvedValue(makeExpenseRecord());
      await expect(
        service.deleteExpense('11111111-1111-4111-8111-111111111111', stranger),
      ).rejects.toThrow(ForbiddenError);
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe('listExpenses', () => {
    it('scopes the query to the actor when they lack EXPENSE_VIEW', async () => {
      repository.findMany.mockResolvedValue({ items: [makeExpenseRecord()], total: 1 });
      await service.listExpenses({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' }, stranger);
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: stranger.id }),
        expect.anything(),
        'createdAt',
        'desc',
      );
    });

    it('does not scope the query when the actor holds EXPENSE_VIEW', async () => {
      rbacService.hasPermission.mockResolvedValue(true);
      repository.findMany.mockResolvedValue({ items: [makeExpenseRecord()], total: 1 });
      await service.listExpenses({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' }, stranger);
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ userId: expect.anything() }),
        expect.anything(),
        'createdAt',
        'desc',
      );
    });

    it('returns paginated items with meta', async () => {
      repository.findMany.mockResolvedValue({ items: [makeExpenseRecord()], total: 1 });
      const result = await service.listExpenses(
        { page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' },
        owner,
      );
      expect(result.expenses).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
