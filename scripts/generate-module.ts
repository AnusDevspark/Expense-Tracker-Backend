import fs from 'node:fs';
import path from 'node:path';

/**
 * Scaffolds a module following the layering in AGENTS.md / docs/adding-a-module.md:
 * schema -> types -> mapper -> repository -> service -> controller -> routes.
 *
 * Usage:
 *   npm run generate:module                                       # generic Task CRUD
 *   npm run generate:module -- --model Task
 *   npm run generate:module -- --schema prisma/schema.prisma --model Task
 *   npm run generate:module -- --schema some.prisma                # only model in file
 *
 * Flags:
 *   --schema <path>   Prisma schema file to read the model from.
 *   --model  <Name>   Model name (required if --schema has more than one model).
 *   --out    <dir>    Output root (default: src/modules).
 *   --force           Overwrite an existing module directory.
 *
 * Writes files under <out>/<module>/, plus a mapper test, a service test and
 * an integration test under tests/unit/ and tests/integration/ (new files
 * named after the module, so there is no shared-file clobber risk). It never
 * touches prisma/schema.prisma, permissions.constant.ts, routes/index.ts,
 * openapi.ts or tests/helpers/database.ts — it prints ready-to-paste snippets
 * for those instead, because an automated edit to a shared file can too
 * easily clobber someone else's in-progress work.
 */

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
  schema?: string;
  model?: string;
  out: string;
  force: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { out: 'src/modules', force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--schema') args.schema = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--out') args.out = argv[++i] ?? args.out;
    else if (a === '--force') args.force = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const HELP = `
generate-module: scaffold an Express/Prisma/Zod module.

  npm run generate:module
  npm run generate:module -- --model Task
  npm run generate:module -- --schema prisma/schema.prisma --model Task
  npm run generate:module -- --schema some.prisma --out src/modules --force

No --schema: generates a generic Task CRUD module (title, description, status, dueDate).
`;

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

function pascalCase(str: string): string {
  return str
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function camelCase(pascal: string): string {
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function kebabCase(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function screamingSnakeCase(pascal: string): string {
  return kebabCase(pascal).replace(/-/g, '_').toUpperCase();
}

function pluralize(word: string): string {
  if (/[sxz]$|[cs]h$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

// ---------------------------------------------------------------------------
// Prisma schema parsing
// ---------------------------------------------------------------------------

type FieldKind = 'scalar' | 'date' | 'enum' | 'decimal';

interface Field {
  name: string;
  kind: FieldKind;
  tsType: string;
  zodBase: string;
  enumName?: string;
  isId: boolean;
  isAuto: boolean;
  /** True for a field literally named `userId` — server-set from the caller, never client-writable. */
  isOwner: boolean;
  optional: boolean;
}

interface ParsedModel {
  fields: Field[];
  enums: Map<string, string[]>;
  fromRealSchema: boolean;
}

const SCALAR_MAP: Record<string, { ts: string; zod: string }> = {
  String: { ts: 'string', zod: 'z.string()' },
  Int: { ts: 'number', zod: 'z.number().int()' },
  Float: { ts: 'number', zod: 'z.number()' },
  Decimal: { ts: 'number', zod: 'z.number()' },
  BigInt: { ts: 'number', zod: 'z.number().int()' },
  Boolean: { ts: 'boolean', zod: 'z.boolean()' },
};

function parseEnums(text: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  const re = /enum\s+(\w+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const members = (m[2] ?? '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter(Boolean);
    enums.set(m[1] ?? '', members);
  }
  return enums;
}

function parseModelNames(text: string): string[] {
  const names: string[] = [];
  const re = /model\s+(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) names.push(m[1] ?? '');
  return names;
}

function parseModelBody(text: string, modelName: string): string | null {
  const re = new RegExp(`model\\s+${modelName}\\s*\\{([^}]*)\\}`);
  const m = re.exec(text);
  return m ? (m[1] ?? '') : null;
}

function scalarType(baseType: string): { tsType: string; zodBase: string } {
  const known = SCALAR_MAP[baseType];
  if (known) return { tsType: known.ts, zodBase: known.zod };
  // Unknown scalar (Json, Bytes, Unsupported, ...) — pass through as string.
  return { tsType: 'string', zodBase: 'z.string()' };
}

/**
 * Turns a Prisma model block into the field metadata the templates below
 * consume. Deliberately does not attempt to resolve relations into joins —
 * a foreign-key scalar column (e.g. `assigneeId String`) comes through as a
 * plain field; the relation object field (e.g. `assignee User @relation(...)`)
 * is dropped. Wire up joins by hand afterwards, same as extending any other
 * generated module.
 */
function extractFields(schemaText: string, modelName: string): ParsedModel | null {
  const body = parseModelBody(schemaText, modelName);
  if (!body) return null;

  const enums = parseEnums(schemaText);
  const modelNames = new Set(parseModelNames(schemaText));

  const fields: Field[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line || line.startsWith('@@')) continue;

    const tokens = line.split(/\s+/);
    const name = tokens[0];
    const type = tokens[1];
    const attrs = tokens.slice(2).join(' ');
    if (!name || !type) continue;

    const isArray = type.endsWith('[]');
    const isOptional = type.endsWith('?');
    const baseType = type.replace(/[[\]?]/g, '');

    if (isArray) continue; // list relation
    if (modelNames.has(baseType)) continue; // relation object field

    const isId = /@id\b/.test(attrs);
    const isUpdatedAt = /@updatedAt\b/.test(attrs) || name === 'updatedAt';
    const isCreatedAtDefault = name === 'createdAt' && /@default\(now\(\)\)/.test(attrs);
    const isAuto = isId || isUpdatedAt || isCreatedAtDefault;
    // A field literally named `userId` is server-set from the authenticated
    // caller in every real module (category/expense/account) — never
    // client-writable, never part of the create/update Zod schema.
    const isOwner = name === 'userId';

    let field: Field;
    if (baseType === 'DateTime') {
      field = { name, kind: 'date', tsType: 'Date', zodBase: 'z.date()', isId, isAuto, isOwner, optional: isOptional };
    } else if (enums.has(baseType)) {
      field = {
        name,
        kind: 'enum',
        tsType: baseType,
        zodBase: `z.enum(${baseType})`,
        enumName: baseType,
        isId,
        isAuto,
        isOwner,
        optional: isOptional,
      };
    } else {
      const { tsType, zodBase } = scalarType(baseType);
      field = {
        name,
        kind: baseType === 'Decimal' ? 'decimal' : 'scalar',
        tsType,
        zodBase,
        isId,
        isAuto,
        isOwner,
        optional: isOptional,
      };
    }

    fields.push(field);
  }

  return { fields, enums, fromRealSchema: true };
}

// ---------------------------------------------------------------------------
// Generic fallback: Task CRUD, no --schema given
// ---------------------------------------------------------------------------

function genericTaskFields(): ParsedModel {
  return {
    fields: [
      { name: 'id', kind: 'scalar', tsType: 'string', zodBase: 'z.string()', isId: true, isAuto: true, isOwner: false, optional: false },
      {
        name: 'title',
        kind: 'scalar',
        tsType: 'string',
        zodBase: 'z.string().trim().min(1).max(200)',
        isId: false,
        isAuto: false,
        isOwner: false,
        optional: false,
      },
      {
        name: 'description',
        kind: 'scalar',
        tsType: 'string',
        zodBase: 'z.string().trim().max(2000)',
        isId: false,
        isAuto: false,
        isOwner: false,
        optional: true,
      },
      {
        name: 'status',
        kind: 'enum',
        enumName: 'TaskStatus',
        tsType: 'TaskStatus',
        zodBase: 'z.enum(TaskStatusValues)',
        isId: false,
        isAuto: false,
        isOwner: false,
        optional: false,
      },
      { name: 'dueDate', kind: 'date', tsType: 'Date', zodBase: 'z.date()', isId: false, isAuto: false, isOwner: false, optional: true },
      { name: 'createdAt', kind: 'date', tsType: 'Date', zodBase: 'z.date()', isId: false, isAuto: true, isOwner: false, optional: false },
      { name: 'updatedAt', kind: 'date', tsType: 'Date', zodBase: 'z.date()', isId: false, isAuto: true, isOwner: false, optional: false },
    ],
    enums: new Map([['TaskStatus', ['TODO', 'IN_PROGRESS', 'DONE']]]),
    fromRealSchema: false,
  };
}

// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------

interface GeneratedModule {
  Pascal: string;
  Plural: string;
  camel: string;
  kebab: string;
  SCREAM: string;
  files: Record<string, string>;
  testFiles: Record<string, string>;
}

function generateModule({
  modelName,
  fields,
  enums,
  fromRealSchema,
}: {
  modelName: string;
  fields: Field[];
  enums: Map<string, string[]>;
  fromRealSchema: boolean;
}): GeneratedModule {
  const Pascal = pascalCase(modelName);
  const Plural = pluralize(Pascal);
  const camel = camelCase(Pascal);
  const kebab = kebabCase(Pascal);
  const SCREAM = screamingSnakeCase(Pascal);

  const nonId = fields.filter((f) => !f.isId);
  const ownerField = fields.find((f) => f.isOwner);
  const hasOwner = !!ownerField;
  const writable = nonId.filter((f) => !f.isAuto && !f.isOwner);
  const enumFields = nonId.filter((f) => f.kind === 'enum');
  // userId is excluded — sorting/searching by an opaque owner FK is meaningless,
  // and no real module (category/account) does it. See category/expense/account.
  const stringFields = nonId.filter((f) => f.kind === 'scalar' && f.tsType === 'string' && !f.isOwner);
  const sortCandidates = nonId.filter((f) => !f.isOwner);
  const defaultSort = sortCandidates.find((f) => f.name === 'createdAt')?.name ?? sortCandidates[0]?.name ?? 'id';
  const sortFields = [...new Set(sortCandidates.map((f) => f.name))];

  const usedEnumNames = [...new Set(fields.filter((f) => f.kind === 'enum').map((f) => f.enumName!))];

  function enumImportLine(): string {
    if (usedEnumNames.length === 0) return '';
    if (fromRealSchema) return `import { ${usedEnumNames.join(', ')} } from '@/generated/prisma/enums';\n`;
    return '';
  }

  function enumLocalTypeDecls(): string {
    if (fromRealSchema || usedEnumNames.length === 0) return '';
    return (
      usedEnumNames
        .map((name) => {
          const members = enums.get(name) ?? [];
          const literals = members.map((m) => `'${m}'`).join(', ');
          return `export const ${name}Values = [${literals}] as const;\nexport type ${name} = (typeof ${name}Values)[number];`;
        })
        .join('\n') + '\n\n'
    );
  }

  // z.enum() needs a runtime value: the real Prisma-generated enum object when
  // the model came from an actual schema, or the `${Name}Values` const tuple
  // this generator writes into types.ts for the generic fallback (a bare `type`
  // has no runtime representation to hand z.enum()).
  function enumRuntimeName(name: string): string {
    return fromRealSchema ? name : `${name}Values`;
  }

  function responseFieldType(f: Field): string {
    if (f.kind === 'date') return 'string';
    if (f.kind === 'enum') return f.enumName!;
    return f.tsType;
  }

  function recordFieldType(f: Field): string {
    if (f.kind === 'date') return 'Date';
    if (f.kind === 'enum') return f.enumName!;
    if (f.kind === 'decimal') return 'Prisma.Decimal';
    return f.tsType;
  }

  // Create/Update input shapes carry the values the service passes through
  // from validated Zod output, not the raw Prisma record shape — a Decimal
  // column is still a plain `number` here (Prisma's write types accept it).
  function inputFieldType(f: Field): string {
    if (f.kind === 'decimal') return 'number';
    return recordFieldType(f);
  }

  // ---- types.ts -------------------------------------------------------

  const responseFields = fields.map(
    (f) => `  ${f.name}${f.optional ? '?' : ''}: ${responseFieldType(f)}${f.optional ? ' | null' : ''};`,
  );
  const recordFields = fields.map(
    (f) => `  ${f.name}${f.optional ? '?' : ''}: ${recordFieldType(f)}${f.optional ? ' | null' : ''};`,
  );
  const createFields = [
    ...writable.map((f) => `  ${f.name}${f.optional ? '?' : ''}: ${inputFieldType(f)};`),
    ...(ownerField ? [`  ${ownerField.name}: string;`] : []),
  ];
  const updateFields = writable.map((f) => `  ${f.name}?: ${inputFieldType(f)};`);
  const filterFields = [
    '  search?: string;',
    ...enumFields.map((f) => `  ${f.name}?: ${f.enumName};`),
    ...(ownerField ? [`  ${ownerField.name}?: string;`] : []),
  ];

  const hasDecimalField = fields.some((f) => f.kind === 'decimal');
  const decimalImportLine = hasDecimalField ? `import type { Prisma } from '@/generated/prisma/client';\n` : '';
  const typesImportBlock = `${decimalImportLine}${enumImportLine()}`;

  const typesTs = `${typesImportBlock}${typesImportBlock ? '\n' : ''}${enumLocalTypeDecls()}/**
 * Types the ${camel} module exposes to the rest of the application.
 *
 * Hand-written rather than re-exported Prisma types, so a column added to the
 * table later cannot silently appear in a response by accident.
 */

/** What the API returns. */
export interface ${Pascal}Response {
${responseFields.join('\n')}
}

/** The database record, as the repository returns it. */
export interface ${Pascal}Record {
${recordFields.join('\n')}
}

/** Whitelisted create fields, built by the service. */
export interface Create${Pascal}Data {
${createFields.length ? createFields.join('\n') : '  [key: string]: never;'}
}

/** Whitelisted update fields. */
export interface Update${Pascal}Data {
${updateFields.length ? updateFields.join('\n') : '  [key: string]: never;'}
}

/** Whitelisted filters. */
export interface ${Pascal}ListFilters {
${filterFields.join('\n')}
}
`;

  // ---- repository.ts -------------------------------------------------------

  const searchFieldNames = stringFields.map((f) => f.name);
  const whereEqualityLines = [
    ...enumFields.map((f) => `        ${f.name}: filters.${f.name},`),
    ...(ownerField ? [`        ${ownerField.name}: filters.${ownerField.name},`] : []),
  ].join('\n');

  const createDataLines = [
    ...writable.map((f) =>
      f.optional
        ? `          ...(data.${f.name} === undefined ? {} : { ${f.name}: data.${f.name} }),`
        : `          ${f.name}: data.${f.name},`,
    ),
    ...(ownerField ? [`          ${ownerField.name}: data.${ownerField.name},`] : []),
  ].join('\n');

  const updateDataLines = writable.map((f) => `          ${f.name}: data.${f.name},`).join('\n');

  const repositoryTs = `import type { PrismaClientInstance, PrismaTransactionClient } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';
import { buildSearchFilter, omitUndefined } from '@/shared/utils/filtering.util';
import { buildOrderBy } from '@/shared/utils/sorting.util';
import type { PaginatedResult, PaginationParams, SortOrder } from '@/shared/types/list-query.type';
import type {
  ${Pascal}ListFilters,
  ${Pascal}Record,
  Create${Pascal}Data,
  Update${Pascal}Data,
} from '@/modules/${kebab}/${kebab}.types';

/** Sortable fields, whitelisted. Also consumed by ${kebab}.schema.ts. */
export const ${SCREAM}_SORT_FIELDS = [
${sortFields.map((n) => `  '${n}',`).join('\n')}
] as const;

export type ${Pascal}SortField = (typeof ${SCREAM}_SORT_FIELDS)[number];

const ${SCREAM}_SEARCH_FIELDS = [${searchFieldNames.map((n) => `'${n}'`).join(', ')}] as const;

export class ${Pascal}Repository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  private buildWhere(filters: ${Pascal}ListFilters) {
    return {
      ...omitUndefined({
${whereEqualityLines || '        // no equality filters — add one per field that needs it'}
      }),
      ...buildSearchFilter(${SCREAM}_SEARCH_FIELDS, filters.search),
    };
  }

  async findById(id: string, tx?: PrismaTransactionClient): Promise<${Pascal}Record | null> {
    return withPrismaErrors('${Pascal}', () => this.client(tx).${camel}.findUnique({ where: { id } }));
  }

  async findMany(
    filters: ${Pascal}ListFilters,
    pagination: PaginationParams,
    sortBy?: string,
    sortOrder: SortOrder = 'desc',
  ): Promise<PaginatedResult<${Pascal}Record>> {
    const where = this.buildWhere(filters);
    const orderBy = buildOrderBy(${SCREAM}_SORT_FIELDS, '${defaultSort}', sortBy, sortOrder);

    return withPrismaErrors('${Pascal}', async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.${camel}.findMany({
          where,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.${camel}.count({ where }),
      ]);

      return { items, total };
    });
  }

  async count(filters: ${Pascal}ListFilters = {}): Promise<number> {
    return withPrismaErrors('${Pascal}', () => this.prisma.${camel}.count({ where: this.buildWhere(filters) }));
  }

  async create(data: Create${Pascal}Data, tx?: PrismaTransactionClient): Promise<${Pascal}Record> {
    return withPrismaErrors('${Pascal}', () =>
      this.client(tx).${camel}.create({
        data: {
${createDataLines || '          // no writable fields — this model is unusual, check the generated types'}
        },
      }),
    );
  }

  async update(id: string, data: Update${Pascal}Data, tx?: PrismaTransactionClient): Promise<${Pascal}Record> {
    return withPrismaErrors('${Pascal}', () =>
      this.client(tx).${camel}.update({
        where: { id },
        data: omitUndefined({
${updateDataLines || '          // no writable fields'}
        }),
      }),
    );
  }

  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    await withPrismaErrors('${Pascal}', () => this.client(tx).${camel}.delete({ where: { id } }));
  }
}
`;

  // ---- schema.ts -------------------------------------------------------

  const hasDateField = writable.some((f) => f.kind === 'date');
  const isoDateHelper = hasDateField
    ? `const isoDateTimeSchema = z.iso
  .datetime({ offset: true, message: 'must be an ISO-8601 date-time, e.g. 2026-03-01T09:00:00Z' })
  .transform((value) => new Date(value));

`
    : '';

  function zodExprFor(f: Field): string {
    if (f.kind === 'date') return 'isoDateTimeSchema';
    if (f.kind === 'enum') return `z.enum(${enumRuntimeName(f.enumName!)})`;
    return f.zodBase;
  }

  const createSchemaLines = writable.map((f) => `  ${f.name}: ${zodExprFor(f)}${f.optional ? '.optional()' : ''},`).join('\n');
  const updateSchemaLines = writable.map((f) => `    ${f.name}: ${zodExprFor(f)}.optional(),`).join('\n');
  const listFilterLines = enumFields
    .map((f) => `    ${f.name}: z.enum(${enumRuntimeName(f.enumName!)}).optional(),`)
    .join('\n');

  const enumValueImport =
    !fromRealSchema && usedEnumNames.length
      ? `import { ${usedEnumNames.map((n) => `${n}Values`).join(', ')} } from '@/modules/${kebab}/${kebab}.types';\n`
      : '';

  const schemaTs = `import { z } from 'zod';
${enumImportLine()}${enumImportLine() ? '\n' : ''}import {
  paginationSchema,
  searchSchema,
  sortingSchema,
  uuidParamSchema,
} from '@/shared/validation/common.schema';
import { ${SCREAM}_SORT_FIELDS } from '@/modules/${kebab}/${kebab}.repository';
${enumValueImport}
export const ${camel}IdParamSchema = uuidParamSchema;

${isoDateHelper}export const list${Plural}QuerySchema = paginationSchema
  .extend(sortingSchema(${SCREAM}_SORT_FIELDS, '${defaultSort}').shape)
  .extend(searchSchema.shape)
  .extend({
${listFilterLines || '    // add per-field filters here as the model grows'}
  });

export const create${Pascal}Schema = z.object({
${createSchemaLines || '  // this model has no writable fields'}
});

export const update${Pascal}Schema = z
  .object({
${updateSchemaLines || '    // this model has no writable fields'}
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });

export type List${Plural}Query = z.infer<typeof list${Plural}QuerySchema>;
export type Create${Pascal}Input = z.infer<typeof create${Pascal}Schema>;
export type Update${Pascal}Input = z.infer<typeof update${Pascal}Schema>;
export type ${Pascal}IdParam = z.infer<typeof ${camel}IdParamSchema>;
`;

  // ---- mapper.ts -------------------------------------------------------

  function mapperFieldLine(f: Field): string {
    if (f.kind === 'date') {
      return f.optional
        ? `    ${f.name}: ${camel}.${f.name} ? ${camel}.${f.name}.toISOString() : null,`
        : `    ${f.name}: ${camel}.${f.name}.toISOString(),`;
    }
    if (f.kind === 'decimal') {
      return f.optional
        ? `    ${f.name}: ${camel}.${f.name} ? ${camel}.${f.name}.toNumber() : null,`
        : `    ${f.name}: ${camel}.${f.name}.toNumber(),`;
    }
    return `    ${f.name}: ${camel}.${f.name},`;
  }

  const mapperTs = `import type { ${Pascal}Record, ${Pascal}Response } from '@/modules/${kebab}/${kebab}.types';

/**
 * Entity -> DTO, field by field. Never \`return { ...${camel} }\` — that would
 * leak the next internal column someone adds to the table.
 */
export function map${Pascal}ToResponse(${camel}: ${Pascal}Record): ${Pascal}Response {
  return {
${fields.map(mapperFieldLine).join('\n')}
  };
}

export function map${Plural}ToResponse(${camel}s: ${Pascal}Record[]): ${Pascal}Response[] {
  return ${camel}s.map(map${Pascal}ToResponse);
}
`;

  // ---- service.ts -------------------------------------------------------
  //
  // When the model has a `userId` owner field (see `ownerField` above), every
  // method threads an `actor: AuthenticatedUser` through: list/create scope to
  // the caller, get/update/delete enforce "you can only touch your own
  // records" with a ForbiddenError. This mirrors category/expense/account —
  // see AGENTS.md and each of those service files.

  const errorsImportLine = hasOwner
    ? `import { ForbiddenError, NotFoundError } from '@/errors';`
    : `import { NotFoundError } from '@/errors';`;
  const actorTypeImportLine = hasOwner
    ? `import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';\n`
    : '';
  const actorParam = hasOwner ? ', actor: AuthenticatedUser' : '';
  const listFilterBlockLines = [
    ...enumFields.map((f) => `        ${f.name}: query.${f.name},`),
    ...(ownerField ? [`        ${ownerField.name}: actor.id,`] : []),
  ].join('\n');
  const createOwnerLine = hasOwner ? `\n      ${ownerField!.name}: actor.id,` : '';

  function ownershipCheck(camelVar: string, verb: string): string {
    if (!hasOwner) return '';
    return `\n\n    if (${camelVar}.${ownerField!.name} !== actor.id) {\n      throw new ForbiddenError('You can only ${verb} your own ${Plural.toLowerCase()}');\n    }`;
  }

  const serviceTs = `${errorsImportLine}
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { ${Pascal}Repository } from '@/modules/${kebab}/${kebab}.repository';
import { map${Plural}ToResponse, map${Pascal}ToResponse } from '@/modules/${kebab}/${kebab}.mapper';
import type { ${Pascal}Response } from '@/modules/${kebab}/${kebab}.types';
import type { Create${Pascal}Input, List${Plural}Query, Update${Pascal}Input } from '@/modules/${kebab}/${kebab}.schema';
${actorTypeImportLine}
export interface Paginated${Plural} {
  ${camel}s: ${Pascal}Response[];
  meta: PaginationMeta;
}

/**
 * ${Pascal} business rules. No Express here — no Request, no Response, no
 * status codes — which is what makes this unit-testable against a mocked
 * repository. Add ownership/authorization rules at the top of the relevant
 * method, not in middleware, per AGENTS.md.
 */
export class ${Pascal}Service {
  constructor(private readonly ${camel}Repository: ${Pascal}Repository) {}

  async list${Plural}(query: List${Plural}Query${actorParam}): Promise<Paginated${Plural}> {
    const pagination = getPagination(query);

    const { items, total } = await this.${camel}Repository.findMany(
      {
        search: query.search,
${listFilterBlockLines}
      },
      pagination,
      query.sortBy,
      query.sortOrder,
    );

    return {
      ${camel}s: map${Plural}ToResponse(items),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async get${Pascal}ById(id: string${actorParam}): Promise<${Pascal}Response> {
    const ${camel} = await this.${camel}Repository.findById(id);
    if (!${camel}) throw new NotFoundError('${Pascal} not found');${ownershipCheck(camel, 'view')}
    return map${Pascal}ToResponse(${camel});
  }

  async create${Pascal}(input: Create${Pascal}Input${actorParam}): Promise<${Pascal}Response> {
    const ${camel} = await this.${camel}Repository.create({
${writable.map((f) => `      ${f.name}: input.${f.name},`).join('\n') || '      // no writable fields'}${createOwnerLine}
    });

    return map${Pascal}ToResponse(${camel});
  }

  async update${Pascal}(id: string, input: Update${Pascal}Input${actorParam}): Promise<${Pascal}Response> {
    const existing = await this.${camel}Repository.findById(id);
    if (!existing) throw new NotFoundError('${Pascal} not found');${ownershipCheck('existing', 'modify')}

    const updated = await this.${camel}Repository.update(id, {
${writable.map((f) => `      ${f.name}: input.${f.name},`).join('\n') || '      // no writable fields'}
    });

    return map${Pascal}ToResponse(updated);
  }

  async delete${Pascal}(id: string${actorParam}): Promise<void> {
    const existing = await this.${camel}Repository.findById(id);
    if (!existing) throw new NotFoundError('${Pascal} not found');${ownershipCheck('existing', 'delete')}
    await this.${camel}Repository.delete(id);
  }
}
`;

  // ---- controller.ts -------------------------------------------------------

  const authImportLine = hasOwner
    ? `import { requireAuthenticatedUser } from '@/shared/utils/auth-context.util';\n`
    : '';
  const actorLine = hasOwner ? `    const actor = requireAuthenticatedUser(req);\n` : '';
  const actorArg = hasOwner ? ', actor' : '';

  const controllerTs = `import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/shared/response/send-response.util';
import type { ${Pascal}Service } from '@/modules/${kebab}/${kebab}.service';
import type {
  ${Pascal}IdParam,
  Create${Pascal}Input,
  List${Plural}Query,
  Update${Pascal}Input,
} from '@/modules/${kebab}/${kebab}.schema';
${authImportLine}
export class ${Pascal}Controller {
  constructor(private readonly ${camel}Service: ${Pascal}Service) {}

  list${Plural} = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as List${Plural}Query;
${actorLine}    const { ${camel}s, meta } = await this.${camel}Service.list${Plural}(query${actorArg});
    sendPaginated(res, ${camel}s, meta);
  };

  get${Pascal} = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as ${Pascal}IdParam;
${actorLine}    const ${camel} = await this.${camel}Service.get${Pascal}ById(id${actorArg});
    sendSuccess(res, ${camel});
  };

  create${Pascal} = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as Create${Pascal}Input;
${actorLine}    const ${camel} = await this.${camel}Service.create${Pascal}(input${actorArg});
    sendCreated(res, ${camel}, '${Pascal} created successfully.');
  };

  update${Pascal} = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as ${Pascal}IdParam;
    const input = req.body as Update${Pascal}Input;
${actorLine}    const ${camel} = await this.${camel}Service.update${Pascal}(id, input${actorArg});
    sendSuccess(res, ${camel}, '${Pascal} updated successfully.');
  };

  delete${Pascal} = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as ${Pascal}IdParam;
${actorLine}    await this.${camel}Service.delete${Pascal}(id${actorArg});
    sendNoContent(res);
  };
}
`;

  // ---- routes.ts -------------------------------------------------------

  const routesTs = `import { Router, type RequestHandler } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { ${Pascal}Controller } from '@/modules/${kebab}/${kebab}.controller';
import {
  create${Pascal}Schema,
  list${Plural}QuerySchema,
  update${Pascal}Schema,
  ${camel}IdParamSchema,
} from '@/modules/${kebab}/${kebab}.schema';

export interface ${Pascal}RouteDependencies {
  controller: ${Pascal}Controller;
  authenticate: RequestHandler;
  requirePermission: (...permissions: string[]) => RequestHandler;
}

export function create${Pascal}Router({ controller, authenticate, requirePermission }: ${Pascal}RouteDependencies): Router {
  const router = Router();

  router.use(authenticate);

  router.get(
    '/',
    requirePermission(PERMISSIONS.${SCREAM}_VIEW),
    validate({ query: list${Plural}QuerySchema }),
    controller.list${Plural},
  );

  router.post(
    '/',
    requirePermission(PERMISSIONS.${SCREAM}_CREATE),
    validate({ body: create${Pascal}Schema }),
    controller.create${Pascal},
  );

  router.get(
    '/:id',
    requirePermission(PERMISSIONS.${SCREAM}_VIEW),
    validate({ params: ${camel}IdParamSchema }),
    controller.get${Pascal},
  );

  router.patch(
    '/:id',
    requirePermission(PERMISSIONS.${SCREAM}_EDIT),
    validate({ params: ${camel}IdParamSchema, body: update${Pascal}Schema }),
    controller.update${Pascal},
  );

  router.delete(
    '/:id',
    requirePermission(PERMISSIONS.${SCREAM}_DELETE),
    validate({ params: ${camel}IdParamSchema }),
    controller.delete${Pascal},
  );

  return router;
}
`;

  // ---- tests/unit/<kebab>.mapper.test.ts -----------------------------------

  const decimalValueImportLine = hasDecimalField
    ? `import { Prisma } from '@/generated/prisma/client';\n`
    : '';

  const optionalTestField = nonId.find((f) => f.optional);

  const mapperRecordFieldLines = [
    `    id: '11111111-1111-4111-8111-111111111111',`,
    ...nonId.map((f) => `    ${f.name}: ${sampleValueExpr(f, enums, true)},`),
  ].join('\n');

  const mapperExpectedKeys = ['id', ...nonId.map((f) => f.name)].sort().map((n) => `    '${n}',`).join('\n');

  const mapperTransformAssertions = nonId
    .filter((f) => f.kind === 'date' || f.kind === 'decimal')
    .map((f) => `  it('maps ${f.name} to ${f.kind === 'date' ? 'an ISO-8601 string' : 'a number'}', () => {\n    const result = map${Pascal}ToResponse(make${Pascal}Record());\n    expect(result.${f.name}).toBe(${expectedResponseValueExpr(f, enums)});\n  });\n`)
    .join('\n');

  const optionalNullTest = optionalTestField
    ? `\n  it('maps a null ${optionalTestField.name} to null', () => {\n    const result = map${Pascal}ToResponse(make${Pascal}Record({ ${optionalTestField.name}: null }));\n    expect(result.${optionalTestField.name}).toBeNull();\n  });\n`
    : '';

  const mapperTestTs = `import { describe, expect, it } from 'vitest';
${decimalValueImportLine}import { map${Pascal}ToResponse } from '@/modules/${kebab}/${kebab}.mapper';
import type { ${Pascal}Record } from '@/modules/${kebab}/${kebab}.types';

/**
 * Generated by npm run generate:module. The field list here is derived
 * mechanically from the Prisma model — extend it with the module's actual
 * business rules once those exist.
 */

function make${Pascal}Record(overrides: Partial<${Pascal}Record> = {}): ${Pascal}Record {
  return {
${mapperRecordFieldLines}
    ...overrides,
  };
}

describe('map${Pascal}ToResponse', () => {
  it('emits exactly the documented fields', () => {
    expect(Object.keys(map${Pascal}ToResponse(make${Pascal}Record())).sort()).toEqual([
${mapperExpectedKeys}
    ]);
  });

${mapperTransformAssertions}${optionalNullTest}});
`;

  // ---- tests/unit/<kebab>.service.test.ts ----------------------------------

  const sampleInputFieldLines = writable.map((f) => `  ${f.name}: ${sampleValueExpr(f, enums, false)},`).join('\n');

  // Owner-scoped modules: the actor's id is deliberately different from the
  // default sample record's userId ('11111111-...'), so make${Pascal}Record()
  // (no override) represents a record owned by someone else, and
  // make${Pascal}Record({ userId: actor.id }) represents one the caller owns —
  // mirrors category/expense/account.service.test.ts conventions.
  const serviceTestErrorsImport = hasOwner ? `import { ForbiddenError, NotFoundError } from '@/errors';` : `import { NotFoundError } from '@/errors';`;
  const serviceTestActorTypeImport = hasOwner
    ? `import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';\n`
    : '';
  const actorConst = hasOwner
    ? `\nconst actor: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'actor@example.com',
  role: 'USER',
};\n`
    : '';
  const actorTestArg = hasOwner ? ', actor' : '';
  const ownedOverride = hasOwner ? `{ ${ownerField!.name}: actor.id }` : '';
  const forbiddenCase = (call: string, notCalled?: string) =>
    hasOwner
      ? `
    it('throws ForbiddenError when the record belongs to someone else', async () => {
      repository.findById.mockResolvedValue(make${Pascal}Record());
      await expect(${call}).rejects.toThrow(ForbiddenError);${notCalled ? `\n      expect(${notCalled}).not.toHaveBeenCalled();` : ''}
    });
`
      : '';

  const serviceTestTs = `import { beforeEach, describe, expect, it, vi } from 'vitest';
${decimalValueImportLine}${serviceTestErrorsImport}
import { ${Pascal}Service } from '@/modules/${kebab}/${kebab}.service';
import type { ${Pascal}Record } from '@/modules/${kebab}/${kebab}.types';
import type { Create${Pascal}Input } from '@/modules/${kebab}/${kebab}.schema';
${serviceTestActorTypeImport}
/**
 * Generated by npm run generate:module. Mocks only what the service calls —
 * see docs/testing.md. Extend with the module's actual business rules once
 * those exist; this file only proves the generated CRUD scaffolding.
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

function make${Pascal}Record(overrides: Partial<${Pascal}Record> = {}): ${Pascal}Record {
  return {
${mapperRecordFieldLines}
    ...overrides,
  };
}
${actorConst}
const sampleInput: Create${Pascal}Input = {
${sampleInputFieldLines || '  // no writable fields'}
};

describe('${Pascal}Service', () => {
  let repository: ReturnType<typeof createMockRepository>;
  let service: ${Pascal}Service;

  beforeEach(() => {
    repository = createMockRepository();
    service = new ${Pascal}Service(repository as never);
  });

  describe('get${Pascal}ById', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.get${Pascal}ById('missing-id'${actorTestArg})).rejects.toThrow(NotFoundError);
    });
${forbiddenCase(`service.get${Pascal}ById('11111111-1111-4111-8111-111111111111'${actorTestArg})`)}
    it('returns the mapped record when found', async () => {
      repository.findById.mockResolvedValue(make${Pascal}Record(${ownedOverride}));
      const result = await service.get${Pascal}ById('11111111-1111-4111-8111-111111111111'${actorTestArg});
      expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    });
  });

  describe('create${Pascal}', () => {
    it('writes exactly the whitelisted fields${hasOwner ? ' plus the caller as owner' : ''}', async () => {
      repository.create.mockResolvedValue(make${Pascal}Record(${ownedOverride}));
      await service.create${Pascal}(sampleInput${actorTestArg});
      expect(repository.create).toHaveBeenCalledWith(${hasOwner ? `{ ...sampleInput, ${ownerField!.name}: actor.id }` : 'sampleInput'});
    });
  });

  describe('update${Pascal}', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.update${Pascal}('missing-id', sampleInput${actorTestArg})).rejects.toThrow(NotFoundError);
      expect(repository.update).not.toHaveBeenCalled();
    });
${forbiddenCase(`service.update${Pascal}('11111111-1111-4111-8111-111111111111', sampleInput${actorTestArg})`, 'repository.update')}
    it('writes exactly the whitelisted fields when the record exists', async () => {
      repository.findById.mockResolvedValue(make${Pascal}Record(${ownedOverride}));
      repository.update.mockResolvedValue(make${Pascal}Record(${ownedOverride}));
      await service.update${Pascal}('11111111-1111-4111-8111-111111111111', sampleInput${actorTestArg});
      expect(repository.update).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', sampleInput);
    });
  });

  describe('delete${Pascal}', () => {
    it('throws NotFoundError when the record does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.delete${Pascal}('missing-id'${actorTestArg})).rejects.toThrow(NotFoundError);
      expect(repository.delete).not.toHaveBeenCalled();
    });
${forbiddenCase(`service.delete${Pascal}('11111111-1111-4111-8111-111111111111'${actorTestArg})`, 'repository.delete')}  });

  describe('list${Plural}', () => {
    it('returns paginated items with meta', async () => {
      repository.findMany.mockResolvedValue({ items: [make${Pascal}Record(${ownedOverride})], total: 1 });
      const result = await service.list${Plural}({ page: 1, pageSize: 20, sortBy: '${defaultSort}', sortOrder: 'desc' }${actorTestArg});
      expect(result.${camel}s).toHaveLength(1);
      expect(result.meta.total).toBe(1);${
        hasOwner
          ? `\n      expect(repository.findMany).toHaveBeenCalledWith(\n        expect.objectContaining({ ${ownerField!.name}: actor.id }),\n        expect.anything(),\n        '${defaultSort}',\n        'desc',\n      );`
          : ''
      }
    });
  });
});
`;

  // ---- tests/integration/<kebab>.integration.test.ts -----------------------

  const plural = pluralize(kebab);
  const placeholderId = '00000000-0000-4000-8000-000000000000';
  const listConst = `${Plural.toUpperCase()}`;
  const itemConst = `${Pascal.toUpperCase()}_ITEM`;
  // update${Pascal}Schema refuses an empty body ("at least one field must be
  // provided"), so a PATCH probing for a 404 needs a body that clears
  // validation on its own — one valid writable field is enough.
  const validPatchBody = writable[0]
    ? `{ ${writable[0].name}: ${expectedResponseValueExpr(writable[0], enums)} }`
    : '{}';

  // Foreign keys besides the owner field itself (e.g. Expense's categoryId /
  // accountId) point at rows this generator has no way to seed, so a generic
  // create in an integration test would just fail its FK constraint. Only
  // attempt the ownership round-trip below when there are none.
  // `writable` already excludes the owner field itself (see above), so this is
  // any other FK-shaped column — categoryId/accountId on Expense, e.g.
  const otherForeignKeys = writable.filter((f) => /Id$/.test(f.name));
  const canGenerateOwnershipTest = hasOwner && otherForeignKeys.length === 0;
  const sampleCreateBody = `{ ${writable.map((f) => `${f.name}: ${sampleValueExpr(f, enums, false)}`).join(', ')} }`;

  const ownershipTestBlock = canGenerateOwnershipTest
    ? `
describe('${Pascal} routes — ownership', () => {
  it('prevents a different caller from accessing the record', async () => {
    const owner = await authenticatedRequest({ role: ROLES.SUPER_ADMIN });
    const intruder = await authenticatedRequest({ role: ROLES.SUPER_ADMIN });

    const created = await request(app)
      .post(${listConst})
      .set(owner.headers)
      .send(${sampleCreateBody})
      .expect(201);
    const id = created.body.data.id;
    const item = \`\${${listConst}}/\${id}\`;

    await request(app).get(item).set(owner.headers).expect(200);
    await request(app).get(item).set(intruder.headers).expect(403);
    await request(app).patch(item).set(intruder.headers).send(${validPatchBody}).expect(403);
    await request(app).delete(item).set(intruder.headers).expect(403);
  });
});
`
    : '';

  const ownershipTodoLine = hasOwner && !canGenerateOwnershipTest
    ? `\n  it.todo('ownership enforcement — needs seed data for ${otherForeignKeys.map((f) => f.name).join(', ')}, see docs/adding-a-module.md Step 12');`
    : '';

  const integrationTestTs = `import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '@/config/constants';
import { ROLES } from '@/shared/constants/roles.constant';
import { getTestApp } from '../helpers/test-app';
import { disconnectDatabase, resetDatabase } from '../helpers/database';
import { authenticatedRequest } from '../helpers/auth';

/**
 * Generated by npm run generate:module. Everything below holds for any
 * generated CRUD module without foreign-key data. Add the happy path and any
 * business rules once the module has real seed data to work with — see
 * docs/adding-a-module.md Step 12.
 */

const app = getTestApp();
const ${listConst} = \`\${API_BASE_PATH}/${plural}\`;
const ${itemConst} = \`\${${listConst}}/${placeholderId}\`;

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('${Pascal} routes — auth and validation', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).get(${listConst}).expect(401);
    await request(app).post(${listConst}).send({}).expect(401);
    await request(app).get(${itemConst}).expect(401);
    await request(app).patch(${itemConst}).send({}).expect(401);
    await request(app).delete(${itemConst}).expect(401);
  });

  it('forbids a user without ${SCREAM}_VIEW from listing', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).get(${listConst}).set(headers).expect(403);
  });

  it('forbids a user without ${SCREAM}_CREATE from creating', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).post(${listConst}).set(headers).send({}).expect(403);
  });

  it('forbids a user without ${SCREAM}_VIEW from reading one', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).get(${itemConst}).set(headers).expect(403);
  });

  it('forbids a user without ${SCREAM}_EDIT from updating', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).patch(${itemConst}).set(headers).send({}).expect(403);
  });

  it('forbids a user without ${SCREAM}_DELETE from deleting', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).delete(${itemConst}).set(headers).expect(403);
  });

  it('rejects an invalid create payload', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.SUPER_ADMIN });
    await request(app).post(${listConst}).set(headers).send({}).expect(400);
  });

  it('returns 404 for an id that does not exist', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.SUPER_ADMIN });
    await request(app).get(${itemConst}).set(headers).expect(404);
    await request(app).patch(${itemConst}).set(headers).send(${validPatchBody}).expect(404);
    await request(app).delete(${itemConst}).set(headers).expect(404);
  });

  it('lists with an empty result when nothing exists', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.SUPER_ADMIN });
    const response = await request(app).get(${listConst}).set(headers).expect(200);
    expect(response.body.data).toEqual([]);
  });

  it.todo('full create/update/delete happy path — needs foreign-key seed data for this module (see docs/adding-a-module.md Step 12)');
  it.todo('model-specific business rules, if any');${ownershipTodoLine}
});
${ownershipTestBlock}`;

  return {
    Pascal,
    Plural,
    camel,
    kebab,
    SCREAM,
    files: {
      [`${kebab}.types.ts`]: typesTs,
      [`${kebab}.repository.ts`]: repositoryTs,
      [`${kebab}.schema.ts`]: schemaTs,
      [`${kebab}.mapper.ts`]: mapperTs,
      [`${kebab}.service.ts`]: serviceTs,
      [`${kebab}.controller.ts`]: controllerTs,
      [`${kebab}.routes.ts`]: routesTs,
    },
    testFiles: {
      [`tests/unit/${kebab}.mapper.test.ts`]: mapperTestTs,
      [`tests/unit/${kebab}.service.test.ts`]: serviceTestTs,
      [`tests/integration/${kebab}.integration.test.ts`]: integrationTestTs,
    },
  };
}

// ---------------------------------------------------------------------------
// Next-steps snippets (printed, never auto-applied to shared files)
// ---------------------------------------------------------------------------

/**
 * The Zod expression for one field in the hand-written OpenAPI response schema
 * (mirrors `userResponseSchema` in src/docs/openapi.ts — a response DTO has no
 * Zod schema of its own to reuse, so this is written out by hand, same as there).
 */
function openApiZodExpr(f: Field, enums: Map<string, string[]>): string {
  let base: string;
  if (f.isId || /Id$/.test(f.name)) {
    base = 'z.uuid()';
  } else if (f.kind === 'date') {
    base = 'z.string()';
  } else if (f.kind === 'enum') {
    const members = (enums.get(f.enumName!) ?? []).map((m) => `'${m}'`).join(', ');
    base = `z.enum([${members}])`;
  } else if (f.kind === 'decimal') {
    base = 'z.number()';
  } else if (f.tsType === 'boolean') {
    base = 'z.boolean()';
  } else if (f.tsType === 'number') {
    base = 'z.number()';
  } else {
    base = 'z.string()';
  }
  return f.optional ? `${base}.nullable()` : base;
}

// ---------------------------------------------------------------------------
// Test file templates (written, not printed — each is a brand-new file named
// after the module, so there is no shared-file clobber risk the way there is
// for permissions.constant.ts / routes/index.ts / openapi.ts).
// ---------------------------------------------------------------------------

/**
 * A fixed, deterministic sample value for one field, as source text.
 *
 * `forRecord` picks the DB-record shape (`Prisma.Decimal` for a decimal
 * column, matching `${Pascal}Record`) vs the validated-input shape (`number`,
 * matching Create/Update${Pascal}Data) — everything else is identical between
 * the two, since Record and input agree on date/enum/string/number/boolean.
 */
function sampleValueExpr(f: Field, enums: Map<string, string[]>, forRecord: boolean): string {
  if (f.isId || /Id$/.test(f.name)) return `'11111111-1111-4111-8111-111111111111'`;
  if (f.kind === 'date') return `new Date('2026-01-02T03:04:05.678Z')`;
  if (f.kind === 'enum') {
    const first = (enums.get(f.enumName!) ?? [])[0] ?? '';
    return `'${first}'`;
  }
  if (f.kind === 'decimal') return forRecord ? `new Prisma.Decimal('123.45')` : '123.45';
  if (f.tsType === 'boolean') return 'true';
  if (f.tsType === 'number') return '42';
  return `'Sample ${f.name}'`;
}

/** What `sampleValueExpr(f, enums, true)` maps to in the response DTO — mirrors `mapperFieldLine`. */
function expectedResponseValueExpr(f: Field, enums: Map<string, string[]>): string {
  if (f.kind === 'date') return `'2026-01-02T03:04:05.678Z'`;
  if (f.kind === 'decimal') return '123.45';
  return sampleValueExpr(f, enums, false);
}

function printNextSteps({
  Pascal,
  Plural,
  camel,
  kebab,
  SCREAM,
  fields,
  enums,
  fromRealSchema,
}: {
  Pascal: string;
  Plural: string;
  camel: string;
  kebab: string;
  SCREAM: string;
  fields: Field[];
  enums: Map<string, string[]>;
  fromRealSchema: boolean;
}): void {
  const nonId = fields.filter((f) => !f.isId);

  console.log('\nNext steps (none of these files were touched):\n');

  if (!fromRealSchema) {
    const enumBlocks = [...enums.entries()]
      .map(([name, members]) => `enum ${name} {\n${members.map((m) => `  ${m}`).join('\n')}\n}`)
      .join('\n\n');
    const modelFields = nonId
      .filter((f) => f.name !== 'createdAt' && f.name !== 'updatedAt')
      .map((f) => {
        if (f.kind === 'date') return `  ${f.name} DateTime${f.optional ? '?' : ''}`;
        if (f.kind === 'enum') {
          const def = enums.get(f.enumName!)?.[0] ?? '';
          return `  ${f.name} ${f.enumName}${f.optional ? '?' : ` @default(${def})`}`;
        }
        return `  ${f.name} String${f.optional ? '?' : ''}`;
      })
      .join('\n');

    console.log(`1. Add to prisma/schema.prisma:\n`);
    console.log(
      `${enumBlocks}\n\nmodel ${Pascal} {\n  id String @id @default(uuid()) @db.Uuid\n\n${modelFields}\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@map("${kebab.replace(/-/g, '_')}s")\n}\n`,
    );
    console.log(`   Then:  npm run prisma:migrate    # name it: add_${kebab.replace(/-/g, '_')}s\n`);
  } else {
    console.log('1. If this schema file is not prisma/schema.prisma itself, merge the model in, then:');
    console.log('   npm run prisma:migrate\n');
  }

  console.log(`2. Add permissions to src/shared/constants/permissions.constant.ts:\n`);
  console.log(
    `   ${SCREAM}_VIEW: '${SCREAM}_VIEW',\n   ${SCREAM}_CREATE: '${SCREAM}_CREATE',\n   ${SCREAM}_EDIT: '${SCREAM}_EDIT',\n   ${SCREAM}_DELETE: '${SCREAM}_DELETE',\n`,
  );
  console.log('   Add matching entries to PERMISSION_DESCRIPTIONS and DEFAULT_ROLE_PERMISSIONS, then:');
  console.log('   npm run prisma:seed\n');

  console.log('3. Wire it up in src/routes/index.ts:\n');
  console.log(`   import { ${Pascal}Repository } from '@/modules/${kebab}/${kebab}.repository';`);
  console.log(`   import { ${Pascal}Service } from '@/modules/${kebab}/${kebab}.service';`);
  console.log(`   import { ${Pascal}Controller } from '@/modules/${kebab}/${kebab}.controller';`);
  console.log(`   import { create${Pascal}Router } from '@/modules/${kebab}/${kebab}.routes';\n`);
  console.log(`   const ${camel}Repository = new ${Pascal}Repository(prisma);`);
  console.log(`   const ${camel}Service = new ${Pascal}Service(${camel}Repository);`);
  console.log(`   const ${camel}Controller = new ${Pascal}Controller(${camel}Service);`);
  console.log(
    `   apiRouter.use('/${pluralize(kebab)}', create${Pascal}Router({ controller: ${camel}Controller, authenticate, requirePermission }));\n`,
  );

  const plural = pluralize(kebab);
  const article = /^[aeiou]/i.test(camel) ? 'an' : 'a';
  const responseSchemaLines = nonId
    .filter((f) => f.name !== 'createdAt' && f.name !== 'updatedAt')
    .map((f) => `     ${f.name}: ${openApiZodExpr(f, enums)},`)
    .join('\n');

  console.log('4. Add paths to src/docs/openapi.ts (optional but recommended):\n');

  console.log('   Import the real request schemas at the top of the file:\n');
  console.log(
    `   import {\n     create${Pascal}Schema,\n     list${Plural}QuerySchema,\n     update${Pascal}Schema,\n     ${camel}IdParamSchema,\n   } from '@/modules/${kebab}/${kebab}.schema';\n`,
  );

  console.log('   Add a hand-written response schema next to the other response shapes');
  console.log('   (there is no Zod schema for a response DTO to reuse, same as userResponseSchema):\n');
  console.log(
    `   const ${camel}ResponseSchema = z.object({\n     id: z.uuid(),\n${responseSchemaLines}\n     createdAt: z.string(),\n     updatedAt: z.string(),\n   });\n`,
  );

  console.log(`   Add to the "tags" array:\n`);
  console.log(`     { name: '${Plural}', description: '${Plural} (permission gated)' },\n`);

  console.log('   Add to the "paths" object:\n');
  console.log(`   '/${plural}': {
     get: {
       tags: ['${Plural}'],
       summary: 'List ${plural}',
       description: 'Requires ${SCREAM}_VIEW.',
       security: bearerAuth,
       requestParams: { query: list${Plural}QuerySchema },
       responses: {
         '200': {
           description: 'Paginated ${plural}',
           content: { 'application/json': { schema: paginatedOf(${camel}ResponseSchema) } },
         },
         ...commonErrors,
       },
     },
     post: {
       tags: ['${Plural}'],
       summary: 'Create ${article} ${camel}',
       description: 'Requires ${SCREAM}_CREATE.',
       security: bearerAuth,
       requestBody: { content: { 'application/json': { schema: create${Pascal}Schema } } },
       responses: {
         '201': {
           description: '${Pascal} created',
           content: { 'application/json': { schema: successOf(${camel}ResponseSchema) } },
         },
         ...conflictResponse,
         ...commonErrors,
       },
     },
   },

   '/${plural}/{id}': {
     get: {
       tags: ['${Plural}'],
       summary: 'Get ${article} ${camel}',
       description: 'Requires ${SCREAM}_VIEW.',
       security: bearerAuth,
       requestParams: { path: ${camel}IdParamSchema },
       responses: {
         '200': {
           description: 'The ${camel}',
           content: { 'application/json': { schema: successOf(${camel}ResponseSchema) } },
         },
         ...notFoundResponse,
         ...commonErrors,
       },
     },
     patch: {
       tags: ['${Plural}'],
       summary: 'Update ${article} ${camel}',
       description: 'Requires ${SCREAM}_EDIT.',
       security: bearerAuth,
       requestParams: { path: ${camel}IdParamSchema },
       requestBody: { content: { 'application/json': { schema: update${Pascal}Schema } } },
       responses: {
         '200': {
           description: 'Updated ${camel}',
           content: { 'application/json': { schema: successOf(${camel}ResponseSchema) } },
         },
         ...notFoundResponse,
         ...commonErrors,
       },
     },
     delete: {
       tags: ['${Plural}'],
       summary: 'Delete ${article} ${camel}',
       description: 'Requires ${SCREAM}_DELETE.',
       security: bearerAuth,
       requestParams: { path: ${camel}IdParamSchema },
       responses: {
         '204': { description: 'Deleted' },
         ...notFoundResponse,
         ...commonErrors,
       },
     },
   },
`);

  console.log(`5. Add '${plural.replace(/-/g, '_')}' to TABLES in tests/helpers/database.ts`);
  console.log("   (use your model's @@map(...) value — the parser doesn't read @@map, this is");
  console.log('   the pluralized-snake-case guess) so npm run test:integration truncates it');
  console.log('   between tests. See docs/testing.md.\n');

  console.log('6. Verify: npm run typecheck && npm run lint && npm test && npm run test:integration\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  let parsed: ParsedModel | null;
  let modelName: string;

  if (args.schema) {
    const schemaPath = path.resolve(process.cwd(), args.schema);
    if (!fs.existsSync(schemaPath)) {
      console.error(`Schema file not found: ${schemaPath}`);
      process.exit(1);
    }
    const text = fs.readFileSync(schemaPath, 'utf8');
    const modelNames = parseModelNames(text);
    if (modelNames.length === 0) {
      console.error(`No \`model\` blocks found in ${schemaPath}`);
      process.exit(1);
    }

    modelName = args.model ?? '';
    if (!modelName) {
      if (modelNames.length === 1) {
        modelName = modelNames[0] ?? '';
      } else {
        console.error(`${schemaPath} has multiple models (${modelNames.join(', ')}). Pass --model <Name>.`);
        process.exit(1);
      }
    }

    parsed = extractFields(text, modelName);
    if (!parsed) {
      console.error(`Model "${modelName}" not found in ${schemaPath}. Available: ${modelNames.join(', ')}`);
      process.exit(1);
    }
  } else {
    modelName = args.model || 'Task';
    parsed = genericTaskFields();
    if (args.model && args.model !== 'Task') {
      console.log(`No --schema given: using the generic Task CRUD field set, renamed to ${pascalCase(args.model)}.`);
    } else {
      console.log('No --schema given: generating a generic Task CRUD module.');
    }
  }

  const result = generateModule({
    modelName,
    fields: parsed.fields,
    enums: parsed.enums,
    fromRealSchema: parsed.fromRealSchema,
  });

  const outDir = path.resolve(process.cwd(), args.out, result.kebab);
  const testFileTargets = Object.keys(result.testFiles).map((rel) => path.resolve(process.cwd(), rel));

  const alreadyExists = [
    ...(fs.existsSync(outDir) ? [outDir] : []),
    ...testFileTargets.filter((p) => fs.existsSync(p)),
  ];
  if (alreadyExists.length > 0 && !args.force) {
    console.error(`Already exists — pass --force to overwrite:\n${alreadyExists.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const [filename, content] of Object.entries(result.files)) {
    fs.writeFileSync(path.join(outDir, filename), content, 'utf8');
    console.log(`  wrote ${path.relative(process.cwd(), path.join(outDir, filename))}`);
  }

  for (const [relPath, content] of Object.entries(result.testFiles)) {
    const target = path.resolve(process.cwd(), relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    console.log(`  wrote ${path.relative(process.cwd(), target)}`);
  }

  printNextSteps({
    Pascal: result.Pascal,
    Plural: result.Plural,
    camel: result.camel,
    kebab: result.kebab,
    SCREAM: result.SCREAM,
    fields: parsed.fields,
    enums: parsed.enums,
    fromRealSchema: parsed.fromRealSchema,
  });
}

main();
