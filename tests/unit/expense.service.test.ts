import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { ForbiddenError, NotFoundError } from '@/errors';
import { ExpenseService } from '@/modules/expense/expense.service';
import type { ExpenseRecord } from '@/modules/expense/expense.types';
import type { AccountRecord } from '@/modules/account/account.types';
import type { CreateExpenseInput } from '@/modules/expense/expense.schema';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

/**
 * Business rule covered here: ownership is absolute. A caller may only ever
 * act on their own expenses — there is no permission that bypasses this. See
 * AGENTS.md and expense.service.ts's doc comment.
 *
 * createExpense/updateExpense/deleteExpense also adjust the related
 * account's balance in the same `$transaction` — see
 * docs/database-transactions.md. `prisma.$transaction` is faked here to just
 * invoke the callback with a marker `tx`, so these tests assert the two
 * repository calls happened together with that marker, not against Postgres.
 */

const TX_MARKER = Symbol('tx');

function createMockPrisma() {
  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(TX_MARKER)),
  };
}

function createMockExpenseRepository() {
  return {
    findById: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockAccountRepository() {
  return {
    findById: vi.fn(),
    adjustBalance: vi.fn(),
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
    category: { id: '11111111-1111-4111-8111-111111111111', name: 'Groceries' },
    accountId: '44444444-4444-4444-8444-444444444444',
    account: { id: '44444444-4444-4444-8444-444444444444', name: 'Checking' },
    userId: '22222222-2222-4222-8222-222222222222',
    createdAt: new Date('2026-01-02T03:04:05.678Z'),
    updatedAt: new Date('2026-01-02T03:04:05.678Z'),
    ...overrides,
  };
}

function makeAccountRecord(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Checking',
    initialBalance: new Prisma.Decimal('1000'),
    balance: new Prisma.Decimal('1000'),
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
  accountId: '44444444-4444-4444-8444-444444444444',
};

describe('ExpenseService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let expenseRepository: ReturnType<typeof createMockExpenseRepository>;
  let accountRepository: ReturnType<typeof createMockAccountRepository>;
  let service: ExpenseService;

  beforeEach(() => {
    prisma = createMockPrisma();
    expenseRepository = createMockExpenseRepository();
    accountRepository = createMockAccountRepository();
    service = new ExpenseService(prisma as never, expenseRepository as never, accountRepository as never);
  });

  describe('getExpenseById', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      expenseRepository.findById.mockResolvedValue(null);
      await expect(service.getExpenseById('missing-id', owner)).rejects.toThrow(NotFoundError);
    });

    it('returns the mapped record for its owner', async () => {
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord());
      const result = await service.getExpenseById('11111111-1111-4111-8111-111111111111', owner);
      expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('throws ForbiddenError for a non-owner', async () => {
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord());
      await expect(
        service.getExpenseById('11111111-1111-4111-8111-111111111111', stranger),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('createExpense', () => {
    it('throws NotFoundError when the account does not exist', async () => {
      accountRepository.findById.mockResolvedValue(null);
      await expect(service.createExpense(sampleInput, owner)).rejects.toThrow(NotFoundError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("throws ForbiddenError for another user's account", async () => {
      accountRepository.findById.mockResolvedValue(makeAccountRecord({ userId: stranger.id }));
      await expect(service.createExpense(sampleInput, owner)).rejects.toThrow(ForbiddenError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('writes exactly the whitelisted fields and debits the account, in the same transaction', async () => {
      accountRepository.findById.mockResolvedValue(makeAccountRecord());
      expenseRepository.create.mockResolvedValue(makeExpenseRecord());

      await service.createExpense(sampleInput, owner);

      expect(expenseRepository.create).toHaveBeenCalledWith(
        {
          title: sampleInput.title,
          description: sampleInput.description,
          amount: sampleInput.amount,
          date: sampleInput.date,
          categoryId: sampleInput.categoryId,
          accountId: sampleInput.accountId,
          userId: owner.id,
        },
        TX_MARKER,
      );
      expect(accountRepository.adjustBalance).toHaveBeenCalledWith(
        sampleInput.accountId,
        -sampleInput.amount,
        TX_MARKER,
      );
    });
  });

  describe('updateExpense', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      expenseRepository.findById.mockResolvedValue(null);
      await expect(service.updateExpense('missing-id', sampleInput, owner)).rejects.toThrow(NotFoundError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ForbiddenError for a non-owner', async () => {
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord());
      await expect(
        service.updateExpense('11111111-1111-4111-8111-111111111111', sampleInput, stranger),
      ).rejects.toThrow(ForbiddenError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('leaves the balance untouched when amount and account are unchanged', async () => {
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord());
      expenseRepository.update.mockResolvedValue(makeExpenseRecord());

      await service.updateExpense('11111111-1111-4111-8111-111111111111', { title: 'Renamed' }, owner);

      expect(expenseRepository.update).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        { title: 'Renamed', description: undefined, amount: undefined, date: undefined, categoryId: undefined, accountId: undefined },
        TX_MARKER,
      );
      expect(accountRepository.adjustBalance).not.toHaveBeenCalled();
    });

    it('reverses the old amount and applies the new one when amount changes', async () => {
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord({ amount: new Prisma.Decimal('50') }));
      expenseRepository.update.mockResolvedValue(makeExpenseRecord());

      await service.updateExpense('11111111-1111-4111-8111-111111111111', { amount: 80 }, owner);

      expect(accountRepository.adjustBalance).toHaveBeenNthCalledWith(1, '44444444-4444-4444-8444-444444444444', 50, TX_MARKER);
      expect(accountRepository.adjustBalance).toHaveBeenNthCalledWith(2, '44444444-4444-4444-8444-444444444444', -80, TX_MARKER);
    });

    it('moves the balance effect to the new account when accountId changes', async () => {
      const newAccountId = '55555555-5555-4555-8555-555555555555';
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord());
      expenseRepository.update.mockResolvedValue(makeExpenseRecord());
      accountRepository.findById.mockResolvedValue(makeAccountRecord({ id: newAccountId }));

      await service.updateExpense('11111111-1111-4111-8111-111111111111', { accountId: newAccountId }, owner);

      expect(accountRepository.adjustBalance).toHaveBeenNthCalledWith(1, '44444444-4444-4444-8444-444444444444', 123.45, TX_MARKER);
      expect(accountRepository.adjustBalance).toHaveBeenNthCalledWith(2, newAccountId, -123.45, TX_MARKER);
    });

    it('throws NotFoundError when moved to an account that does not exist', async () => {
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord());
      accountRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateExpense('11111111-1111-4111-8111-111111111111', { accountId: 'missing' }, owner),
      ).rejects.toThrow(NotFoundError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("throws ForbiddenError when moved to another user's account", async () => {
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord());
      accountRepository.findById.mockResolvedValue(makeAccountRecord({ userId: stranger.id }));

      await expect(
        service.updateExpense('11111111-1111-4111-8111-111111111111', { accountId: 'other' }, owner),
      ).rejects.toThrow(ForbiddenError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('deleteExpense', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      expenseRepository.findById.mockResolvedValue(null);
      await expect(service.deleteExpense('missing-id', owner)).rejects.toThrow(NotFoundError);
      expect(expenseRepository.delete).not.toHaveBeenCalled();
    });

    it('deletes and restores the account balance in the same transaction', async () => {
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord());
      await service.deleteExpense('11111111-1111-4111-8111-111111111111', owner);
      expect(expenseRepository.delete).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', TX_MARKER);
      expect(accountRepository.adjustBalance).toHaveBeenCalledWith(
        '44444444-4444-4444-8444-444444444444',
        123.45,
        TX_MARKER,
      );
    });

    it('throws ForbiddenError for a non-owner', async () => {
      expenseRepository.findById.mockResolvedValue(makeExpenseRecord());
      await expect(
        service.deleteExpense('11111111-1111-4111-8111-111111111111', stranger),
      ).rejects.toThrow(ForbiddenError);
      expect(expenseRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('listExpenses', () => {
    it('always scopes the query to the actor', async () => {
      expenseRepository.findMany.mockResolvedValue({ items: [makeExpenseRecord()], total: 1 });
      await service.listExpenses({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' }, stranger);
      expect(expenseRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: stranger.id }),
        expect.anything(),
        'createdAt',
        'desc',
      );
    });

    it('returns paginated items with meta', async () => {
      expenseRepository.findMany.mockResolvedValue({ items: [makeExpenseRecord()], total: 1 });
      const result = await service.listExpenses(
        { page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' },
        owner,
      );
      expect(result.expenses).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
