import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '@/config/constants';
import { ROLES } from '@/shared/constants/roles.constant';
import { getTestApp } from '../helpers/test-app';
import { disconnectDatabase, resetDatabase } from '../helpers/database';
import { authenticatedRequest } from '../helpers/auth';

const app = getTestApp();
const EXPENSES = `${API_BASE_PATH}/expenses`;
const CATEGORIES = `${API_BASE_PATH}/categories`;
const EXPENSE_ITEM = `${EXPENSES}/00000000-0000-4000-8000-000000000000`;

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

/** Creates a category owned by `headers`'s user, for the expense FK. */
async function createCategory(headers: Record<string, string>): Promise<string> {
  const response = await request(app)
    .post(CATEGORIES)
    .set(headers)
    .send({ name: 'Groceries', type: 'EXPENSE' })
    .expect(201);
  return response.body.data.id as string;
}

describe('Expense routes — auth and validation', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).get(EXPENSES).expect(401);
    await request(app).post(EXPENSES).send({}).expect(401);
    await request(app).get(EXPENSE_ITEM).expect(401);
    await request(app).patch(EXPENSE_ITEM).send({}).expect(401);
    await request(app).delete(EXPENSE_ITEM).expect(401);
  });

  // ADMIN is not granted any EXPENSE_* permission by default (only USER is —
  // see permissions.constant.ts), so it stands in here for "no access at all".
  it('forbids a role without EXPENSE_VIEW from listing', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).get(EXPENSES).set(headers).expect(403);
  });

  it('forbids a role without EXPENSE_CREATE from creating', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).post(EXPENSES).set(headers).send({}).expect(403);
  });

  it('forbids a role without EXPENSE_VIEW from reading one', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).get(EXPENSE_ITEM).set(headers).expect(403);
  });

  it('forbids a role without EXPENSE_EDIT from updating', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).patch(EXPENSE_ITEM).set(headers).send({}).expect(403);
  });

  it('forbids a role without EXPENSE_DELETE from deleting', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).delete(EXPENSE_ITEM).set(headers).expect(403);
  });

  it('rejects an invalid create payload', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).post(EXPENSES).set(headers).send({}).expect(400);
  });

  it('returns 404 for an id that does not exist', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).get(EXPENSE_ITEM).set(headers).expect(404);
    await request(app).patch(EXPENSE_ITEM).set(headers).send({ title: 'Sample title' }).expect(404);
    await request(app).delete(EXPENSE_ITEM).set(headers).expect(404);
  });

  it('lists with an empty result when nothing exists', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    const response = await request(app).get(EXPENSES).set(headers).expect(200);
    expect(response.body.data).toEqual([]);
  });

  it('full create/update/delete happy path', async () => {
    const { user, headers } = await authenticatedRequest({ role: ROLES.USER });
    const categoryId = await createCategory(headers);

    const created = await request(app)
      .post(EXPENSES)
      .set(headers)
      .send({ title: 'Coffee', amount: 4.5, date: '2026-01-02T00:00:00Z', categoryId })
      .expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data.userId).toBe(user.id);

    const updated = await request(app)
      .patch(`${EXPENSES}/${id}`)
      .set(headers)
      .send({ title: 'Coffee and pastry' })
      .expect(200);
    expect(updated.body.data.title).toBe('Coffee and pastry');

    await request(app).delete(`${EXPENSES}/${id}`).set(headers).expect(204);
    await request(app).get(`${EXPENSES}/${id}`).set(headers).expect(404);
  });
});

describe('Expense ownership', () => {
  it('lets a user view, update, and delete their own expense', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    const categoryId = await createCategory(headers);
    const created = await request(app)
      .post(EXPENSES)
      .set(headers)
      .send({ title: 'Own expense', amount: 10, date: '2026-01-02T00:00:00Z', categoryId })
      .expect(201);
    const id = created.body.data.id as string;

    await request(app).get(`${EXPENSES}/${id}`).set(headers).expect(200);
    await request(app).patch(`${EXPENSES}/${id}`).set(headers).send({ title: 'Renamed' }).expect(200);
  });

  it('forbids a different user from viewing, updating, or deleting it, despite holding the same permissions', async () => {
    const owner = await authenticatedRequest({ role: ROLES.USER });
    const categoryId = await createCategory(owner.headers);
    const created = await request(app)
      .post(EXPENSES)
      .set(owner.headers)
      .send({ title: "Owner's expense", amount: 10, date: '2026-01-02T00:00:00Z', categoryId })
      .expect(201);
    const id = created.body.data.id as string;

    const stranger = await authenticatedRequest({ role: ROLES.USER });

    await request(app).get(`${EXPENSES}/${id}`).set(stranger.headers).expect(403);
    await request(app).patch(`${EXPENSES}/${id}`).set(stranger.headers).send({ title: 'Hacked' }).expect(403);
    await request(app).delete(`${EXPENSES}/${id}`).set(stranger.headers).expect(403);

    // Untouched — the owner still sees the original record.
    const stillThere = await request(app).get(`${EXPENSES}/${id}`).set(owner.headers).expect(200);
    expect(stillThere.body.data.title).toBe("Owner's expense");
  });

  it("excludes another user's expenses from the list", async () => {
    const owner = await authenticatedRequest({ role: ROLES.USER });
    const categoryId = await createCategory(owner.headers);
    await request(app)
      .post(EXPENSES)
      .set(owner.headers)
      .send({ title: "Owner's expense", amount: 10, date: '2026-01-02T00:00:00Z', categoryId })
      .expect(201);

    const stranger = await authenticatedRequest({ role: ROLES.USER });
    const response = await request(app).get(EXPENSES).set(stranger.headers).expect(200);
    expect(response.body.data).toEqual([]);
  });
});
