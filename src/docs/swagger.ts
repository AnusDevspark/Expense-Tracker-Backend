import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { logger } from '@/config/logger';
import { buildOpenApiDocument } from '@/docs/openapi';

/**
 * Mounts Swagger UI and the raw spec.
 *
 * The document is built once at startup rather than per request — it is derived
 * from static schemas, so rebuilding it on every page load is pure waste.
 *
 * `/api/docs.json` is exposed alongside the UI because that is what client
 * generators, Postman and contract tests consume.
 *
 * In production, consider setting SWAGGER_ENABLED=false for a private API: the
 * document is an exact map of your attack surface, including which permissions
 * guard which endpoint.
 */
export function mountSwagger(app: Express, path: string): void {
  const document = buildOpenApiDocument();
  const jsonPath = `${path}.json`;

  app.get(jsonPath, (_req, res) => {
    res.json(document);
  });

  // Injects a "docs.json" link into the Swagger UI topbar so the raw spec
  // can be opened/copied without knowing the route by heart.
  app.get(`${path}/topbar-link.js`, (_req, res) => {
    res.type('application/javascript').send(`
      window.addEventListener('load', function () {
        var wrapper = document.querySelector('.topbar-wrapper') || document.querySelector('.topbar .link');
        if (!wrapper) return;
        var link = document.createElement('a');
        link.href = ${JSON.stringify(jsonPath)};
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'docs.json';
        link.style.cssText = 'color:#fff;margin-left:16px;font-size:14px;text-decoration:underline;';
        wrapper.appendChild(link);
      });
    `);
  });

  app.use(
    path,
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'API Documentation',
      customJs: `${path}/topbar-link.js`,
      swaggerOptions: {
        // Keep the bearer token across page reloads so testing endpoints in the
        // UI does not mean re-authorising constantly.
        persistAuthorization: true,
        docExpansion: 'list',
        tagsSorter: 'alpha',
      },
    }),
  );

  logger.info({ path }, 'API documentation mounted');
}
