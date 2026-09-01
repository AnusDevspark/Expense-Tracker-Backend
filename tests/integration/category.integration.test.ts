import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '@/config/constants';
import { ROLES } from '@/shared/constants/roles.constant';
import { getTestApp } from '../helpers/test-app';
import { disconnectDatabase, resetDatabase } from '../helpers/database';
import { authenticatedRequest } from '../helpers/auth';

const app = getTestApp();
const CATEGORIES = `${API_BASE_PATH}/categories`;
const CATEGORY_ITEM = `${CATEGORIES}/00000000-0000-4000-8000-000000000000`;

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('Category routes — auth and validation', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).get(CATEGORIES).expect(401);
    await request(app).post(CATEGORIES).send({}).expect(401);
    await request(app).get(CATEGORY_ITEM).expect(401);
    await request(app).patch(CATEGORY_ITEM).send({}).expect(401);
    await request(app).delete(CATEGORY_ITEM).expect(401);
  });

  // ADMIN is not granted any CATEGORY_* permission by default (only USER is —
  // see permissions.constant.ts), so it stands in here for "no access at all".
  it('forbids a role without CATEGORY_VIEW from listing', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).get(CATEGORIES).set(headers).expect(403);
  });

  it('forbids a role without CATEGORY_CREATE from creating', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).post(CATEGORIES).set(headers).send({}).expect(403);
  });

  it('forbids a role without CATEGORY_VIEW from reading one', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).get(CATEGORY_ITEM).set(headers).expect(403);
  });

  it('forbids a role without CATEGORY_EDIT from updating', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).patch(CATEGORY_ITEM).set(headers).send({}).expect(403);
  });

  it('forbids a role without CATEGORY_DELETE from deleting', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).delete(CATEGORY_ITEM).set(headers).expect(403);
  });

  it('rejects an invalid create payload', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).post(CATEGORIES).set(headers).send({}).expect(400);
  });

  it('returns 404 for an id that does not exist', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).get(CATEGORY_ITEM).set(headers).expect(404);
    await request(app).patch(CATEGORY_ITEM).set(headers).send({ name: 'Sample name' }).expect(404);
    await request(app).delete(CATEGORY_ITEM).set(headers).expect(404);
  });

  it('lists with an empty result when nothing exists', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    const response = await request(app).get(CATEGORIES).set(headers).expect(200);
    expect(response.body.data).toEqual([]);
  });

  it('full create/update/delete happy path', async () => {
    const { user, headers } = await authenticatedRequest({ role: ROLES.USER });

    const created = await request(app)
      .post(CATEGORIES)
      .set(headers)
      .send({ name: 'Groceries', type: 'EXPENSE' })
      .expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data.userId).toBe(user.id);

    const updated = await request(app)
      .patch(`${CATEGORIES}/${id}`)
      .set(headers)
      .send({ name: 'Groceries & household' })
      .expect(200);
    expect(updated.body.data.name).toBe('Groceries & household');

    await request(app).delete(`${CATEGORIES}/${id}`).set(headers).expect(204);
    await request(app).get(`${CATEGORIES}/${id}`).set(headers).expect(404);
  });
});

describe('Category ownership', () => {
  it('lets a user view and update their own category', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    const created = await request(app)
      .post(CATEGORIES)
      .set(headers)
      .send({ name: 'Own category', type: 'EXPENSE' })
      .expect(201);
    const id = created.body.data.id as string;

    await request(app).get(`${CATEGORIES}/${id}`).set(headers).expect(200);
    await request(app).patch(`${CATEGORIES}/${id}`).set(headers).send({ name: 'Renamed' }).expect(200);
  });

  it('forbids a different user from viewing, updating, or deleting it, despite holding the same permissions', async () => {
    const owner = await authenticatedRequest({ role: ROLES.USER });
    const created = await request(app)
      .post(CATEGORIES)
      .set(owner.headers)
      .send({ name: "Owner's category", type: 'EXPENSE' })
      .expect(201);
    const id = created.body.data.id as string;

    const stranger = await authenticatedRequest({ role: ROLES.USER });

    await request(app).get(`${CATEGORIES}/${id}`).set(stranger.headers).expect(403);
    await request(app).patch(`${CATEGORIES}/${id}`).set(stranger.headers).send({ name: 'Hacked' }).expect(403);
    await request(app).delete(`${CATEGORIES}/${id}`).set(stranger.headers).expect(403);

    const stillThere = await request(app).get(`${CATEGORIES}/${id}`).set(owner.headers).expect(200);
    expect(stillThere.body.data.name).toBe("Owner's category");
  });

  it("excludes another user's categories from the list", async () => {
    const owner = await authenticatedRequest({ role: ROLES.USER });
    await request(app)
      .post(CATEGORIES)
      .set(owner.headers)
      .send({ name: "Owner's category", type: 'EXPENSE' })
      .expect(201);

    const stranger = await authenticatedRequest({ role: ROLES.USER });
    const response = await request(app).get(CATEGORIES).set(stranger.headers).expect(200);
    expect(response.body.data).toEqual([]);
  });
});
