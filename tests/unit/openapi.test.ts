import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '@/docs/openapi';

describe('buildOpenApiDocument', () => {
  it('documents the mounted HTTP routes', () => {
    const document = buildOpenApiDocument();

    expect(Object.keys(document.paths ?? {})).toEqual([
      '/',
      '/health',
      '/health/live',
      '/health/ready',
      '/auth/register',
      '/auth/login',
      '/auth/refresh',
      '/auth/logout',
      '/auth/me',
      '/auth/change-password',
      '/users',
      '/users/{id}',
      '/categories',
      '/categories/{id}',
      '/expenses',
      '/expenses/{id}',
      '/accounts',
      '/accounts/{id}',
    ]);
  });

  it('documents the actual expense response DTO', () => {
    const document = buildOpenApiDocument();
    const createExpense = document.paths?.['/expenses']?.post;
    const createdSchema = createExpense?.responses?.['201']?.content?.['application/json']?.schema;

    expect(createdSchema).toMatchObject({
      properties: {
        data: {
          required: expect.arrayContaining(['categoryName', 'accountId', 'accountName']),
        },
      },
    });
    expect(Object.keys(createExpense?.responses ?? {})).toContain('404');
  });
});
