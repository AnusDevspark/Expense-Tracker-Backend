import { ROLES, type RoleName } from '@/shared/constants/roles.constant';

/**
 * Permission keys.
 *
 * Naming is RESOURCE_ACTION. Application code always checks a permission, never
 * a role — that is what lets an operator invent a "SUPPORT" role that can view
 * users but not delete them, with no code change.
 *
 * Where the source of truth lives: the *keys* are here in code because they are
 * referenced by `requirePermission(PERMISSIONS.PROVIDER_CREATE)` at call sites
 * and must be typo-proof. The *grants* — which role has which permission — live
 * in the database, because that is the part operators need to change at runtime.
 * The map below is only the seed's starting point, not the runtime authority.
 */
export const PERMISSIONS = {
  USER_VIEW: 'USER_VIEW',
  USER_CREATE: 'USER_CREATE',
  USER_EDIT: 'USER_EDIT',
  USER_DELETE: 'USER_DELETE',

  ROLE_MANAGE: 'ROLE_MANAGE',

  CATEGORY_VIEW: 'CATEGORY_VIEW',
  CATEGORY_CREATE: 'CATEGORY_CREATE',
  CATEGORY_EDIT: 'CATEGORY_EDIT',
  CATEGORY_DELETE: 'CATEGORY_DELETE',

  EXPENSE_VIEW: 'EXPENSE_VIEW',
  EXPENSE_CREATE: 'EXPENSE_CREATE',
  EXPENSE_EDIT: 'EXPENSE_EDIT',
  EXPENSE_DELETE: 'EXPENSE_DELETE',

  ACCOUNT_VIEW: 'ACCOUNT_VIEW',
  ACCOUNT_CREATE: 'ACCOUNT_CREATE',
  ACCOUNT_EDIT: 'ACCOUNT_EDIT',
  ACCOUNT_DELETE: 'ACCOUNT_DELETE',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  USER_VIEW: 'List and read user accounts',
  USER_CREATE: 'Create user accounts',
  USER_EDIT: 'Modify user accounts',
  USER_DELETE: 'Delete user accounts',
  ROLE_MANAGE: 'Create roles and change their permissions',

  CATEGORY_VIEW: 'List and read categories',
  CATEGORY_CREATE: 'Create categories',
  CATEGORY_EDIT: 'Modify categories',
  CATEGORY_DELETE: 'Delete categories',

  EXPENSE_VIEW: 'List and read expenses',
  EXPENSE_CREATE: 'Create expenses',
  EXPENSE_EDIT: 'Modify expenses',
  EXPENSE_DELETE: 'Delete expenses',

  ACCOUNT_VIEW: 'List and check accounts',
  ACCOUNT_CREATE: 'Create accounts',
  ACCOUNT_EDIT: 'Modify accounts',
  ACCOUNT_DELETE: 'Delete accounts',
};

/**
 * Initial grants applied by `npm run prisma:seed`.
 *
 * Seeding only *adds* the rows it declares; it never deletes grants an operator
 * made by hand, so re-running the seed after a permission change is safe.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  [ROLES.SUPER_ADMIN]: ALL_PERMISSIONS,
  // An admin manages people but cannot delete them or reshape the role system —
  // those stay with SUPER_ADMIN.
  [ROLES.ADMIN]: [PERMISSIONS.USER_VIEW, PERMISSIONS.USER_CREATE, PERMISSIONS.USER_EDIT],
  // A standard user gets expense/category access by default so they can track
  // their own spending. Editing their *own* profile, expenses, and categories
  // is an ownership rule enforced in the relevant service, not a permission —
  // see docs/architecture.md on role vs ownership authorization. These
  // permissions only gate whether the feature is usable at all; ownership
  // always scopes each user to their own records, with no bypass for any role.
  [ROLES.USER]: [
    PERMISSIONS.CATEGORY_CREATE,
    PERMISSIONS.CATEGORY_VIEW,
    PERMISSIONS.CATEGORY_EDIT,
    PERMISSIONS.CATEGORY_DELETE,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_VIEW,
    PERMISSIONS.EXPENSE_EDIT,
    PERMISSIONS.EXPENSE_DELETE,
  ],
};
