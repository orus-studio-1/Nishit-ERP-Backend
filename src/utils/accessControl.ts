import prisma from '../lib/prisma';

export type AccessAction =
  | 'READ'
  | 'CREATE'
  | 'WRITE'
  | 'DELETE'
  | 'SUBMIT'
  | 'CANCEL'
  | 'AMEND'
  | 'APPROVE'
  | 'EXPORT'
  | 'IMPORT'
  | 'PRINT'
  | 'REPORT'
  | 'MANAGE';

export type EffectiveAccess = {
  companyId?: string | null;
  isSuperAdmin: boolean;
  permissions: string[];
  deniedPermissions: string[];
  roles: Array<{ id: string; name: string; title?: string | null; isSuperAdmin?: boolean }>;
};

export const ERP_MODULES = [
  { module: 'dashboard', label: 'Dashboard', resources: ['dashboard'], actions: ['READ'] },
  { module: 'access', label: 'Access Control', resources: ['users', 'roles', 'permissions', 'audit'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'MANAGE'] },
  { module: 'company', label: 'Company Settings', resources: ['company'], actions: ['READ', 'WRITE', 'MANAGE'] },
  { module: 'accounting', label: 'Accounting', resources: ['accounts', 'journal-entries', 'gl-entries', 'fiscal-years', 'periods', 'cost-centers', 'budgets', 'bank-statement-lines', 'reconciliation', 'period-closing', 'reports', 'tax-ledger', 'ar-ap-ledger'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'SUBMIT', 'CANCEL', 'APPROVE', 'REPORT', 'EXPORT', 'MANAGE'] },
  { module: 'inventory', label: 'Inventory', resources: ['products', 'categories', 'warehouses', 'stock-movements', 'stock-entries', 'stock-ledger', 'stock-balance', 'projected-stock', 'reserved-stock', 'warehouse-valuation', 'item-wise-sales', 'gross-profit', 'slow-moving-stock', 'price-lists', 'item-prices', 'pricing-rules', 'attributes', 'batches', 'serial-numbers', 'units'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'SUBMIT', 'CANCEL', 'REPORT', 'EXPORT', 'IMPORT', 'MANAGE'] },
  { module: 'hr', label: 'HR', resources: ['employees', 'departments', 'positions', 'attendance', 'leave', 'payroll', 'salary', 'lifecycle', 'shifts'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'APPROVE', 'SUBMIT', 'CANCEL', 'REPORT', 'EXPORT', 'MANAGE'] },
  { module: 'crm', label: 'CRM', resources: ['dashboard', 'leads', 'imports', 'organizations', 'contacts', 'opportunities', 'activities', 'saved-views', 'assignment-rules'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'APPROVE', 'REPORT', 'EXPORT', 'IMPORT', 'MANAGE'] },
  { module: 'sales', label: 'Sales', resources: ['quotations', 'sales-orders'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'SUBMIT', 'CANCEL', 'AMEND', 'APPROVE', 'PRINT', 'EXPORT'] },
  { module: 'invoicing', label: 'Invoicing', resources: ['sales-invoices', 'payments', 'payment-entries', 'delivery-notes', 'credit-notes', 'tax-templates', 'ledger', 'print-formats', 'subscriptions', 'reports', 'audit-log'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'SUBMIT', 'CANCEL', 'AMEND', 'APPROVE', 'PRINT', 'REPORT', 'EXPORT'] },
  { module: 'procurement', label: 'Procurement', resources: ['dashboard', 'settings', 'payment-terms', 'supplier-items', 'material-requests', 'rfqs', 'supplier-quotations', 'blanket-purchase-orders', 'purchase-orders', 'purchase-receipts', 'quality-inspections', 'landed-cost-vouchers', 'purchase-invoices', 'supplier-payments', 'tracker', 'communications'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'SUBMIT', 'CANCEL', 'APPROVE', 'PRINT', 'REPORT', 'EXPORT', 'MANAGE'] },
  { module: 'projects', label: 'Projects', resources: ['projects', 'tasks', 'milestones', 'comments', 'members'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'APPROVE', 'REPORT', 'EXPORT'] },
  { module: 'customers', label: 'Customers', resources: ['customers'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'REPORT', 'EXPORT', 'IMPORT'] },
  { module: 'suppliers', label: 'Suppliers', resources: ['suppliers'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'REPORT', 'EXPORT', 'IMPORT'] },
] as const;

export function permissionKey(module: string, resource: string, action: string) {
  return `${module}:${resource}:${action}`.toLowerCase();
}

export function moduleWildcardKey(module: string, action: string) {
  return `${module}:*:${action}`.toLowerCase();
}

export function getActionForRequest(method: string, path = ''): AccessAction {
  const normalized = path.toLowerCase();
  if (normalized.includes('/status') || normalized.includes('/post')) return 'SUBMIT';
  if (normalized.includes('/cancel')) return 'CANCEL';
  if (normalized.includes('/approve')) return 'APPROVE';
  if (normalized.includes('/amend')) return 'AMEND';
  if (normalized.includes('/pdf') || normalized.includes('/print')) return 'PRINT';
  if (normalized.includes('/reports') || normalized.includes('/report')) return 'REPORT';
  if (method === 'GET') return 'READ';
  if (method === 'POST') return 'CREATE';
  if (method === 'PUT' || method === 'PATCH') return 'WRITE';
  if (method === 'DELETE') return 'DELETE';
  return 'READ';
}

export function firstPathSegment(path = '') {
  return path.split('?')[0].split('/').filter(Boolean)[0] || '*';
}

export function permissionCatalog() {
  return ERP_MODULES.flatMap((m) =>
    m.resources.flatMap((resource) =>
      m.actions.map((action) => ({
        key: permissionKey(m.module, resource, action),
        module: m.module,
        resource,
        action,
        label: `${m.label}: ${resource.replace(/-/g, ' ')} ${String(action).toLowerCase()}`,
        description: `Allows ${String(action).toLowerCase()} on ${resource} in ${m.label}.`,
      }))
    )
  );
}

export async function ensureSystemPermissions(tx: any = prisma) {
  const permissions = permissionCatalog();
  await tx.permission.createMany({
    data: permissions.map((permission) => ({
      key: permission.key,
      module: permission.module,
      resource: permission.resource,
      action: permission.action,
      label: permission.label,
      description: permission.description,
      isSystem: true,
    })),
    skipDuplicates: true,
  });
}

const DEFAULT_ROLE_RULES: Record<string, { title: string; modules: string[]; actions?: string[]; super?: boolean }> = {
  SUPER_ADMIN: { title: 'Super Admin', modules: ['*'], super: true },
  ADMIN: { title: 'Admin', modules: ['dashboard', 'company', 'access', 'accounting', 'inventory', 'hr', 'crm', 'sales', 'invoicing', 'procurement', 'projects', 'customers', 'suppliers'] },
  HR_MANAGER: { title: 'HR Manager', modules: ['dashboard', 'hr'], actions: ['READ', 'CREATE', 'WRITE', 'APPROVE', 'SUBMIT', 'REPORT', 'EXPORT', 'MANAGE'] },
  ACCOUNTANT: { title: 'Accountant', modules: ['dashboard', 'accounting', 'invoicing', 'customers'], actions: ['READ', 'CREATE', 'WRITE', 'SUBMIT', 'CANCEL', 'REPORT', 'PRINT', 'EXPORT'] },
  SALES_MANAGER: { title: 'Sales Manager', modules: ['dashboard', 'sales', 'invoicing', 'customers', 'crm'], actions: ['READ', 'CREATE', 'WRITE', 'SUBMIT', 'REPORT', 'PRINT', 'EXPORT'] },
  INVENTORY_MANAGER: { title: 'Inventory Manager', modules: ['dashboard', 'inventory', 'suppliers', 'procurement'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'SUBMIT', 'REPORT', 'EXPORT', 'IMPORT'] },
  PROJECT_MANAGER: { title: 'Project Manager', modules: ['dashboard', 'projects'], actions: ['READ', 'CREATE', 'WRITE', 'DELETE', 'APPROVE', 'REPORT'] },
  EMPLOYEE_SELF_SERVICE: { title: 'Employee Self Service', modules: ['dashboard'], actions: ['READ'] },
};

export async function ensureCompanyDefaultRoles(companyId: string, tx: any = prisma) {
  await ensureSystemPermissions(tx);
  const permissions = await tx.permission.findMany();
  const byModule = new Map<string, any[]>();
  for (const permission of permissions) {
    if (!byModule.has(permission.module)) byModule.set(permission.module, []);
    byModule.get(permission.module)!.push(permission);
  }

  const roles: Record<string, any> = {};
  for (const [name, rule] of Object.entries(DEFAULT_ROLE_RULES)) {
    const role = await tx.accessRole.upsert({
      where: { companyId_name: { companyId, name } },
      update: { title: rule.title, isSystem: true, isSuperAdmin: !!rule.super, isActive: true },
      create: { companyId, name, title: rule.title, isSystem: true, isSuperAdmin: !!rule.super, isActive: true },
    });
    roles[name] = role;

    const allowed = rule.modules.includes('*')
      ? permissions
      : permissions.filter((p: any) => rule.modules.includes(p.module) && (!rule.actions || rule.actions.includes(p.action)));
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (allowed.length) {
      await tx.rolePermission.createMany({
        data: allowed.map((permission: any) => ({ roleId: role.id, permissionId: permission.id, effect: 'ALLOW' })),
        skipDuplicates: true,
      });
    }
  }
  return roles;
}

export async function computeEffectiveAccess(userId: string): Promise<EffectiveAccess> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      accessRoles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
      permissionOverrides: { include: { permission: true } },
    },
  });
  if (!user) return { isSuperAdmin: false, permissions: [], deniedPermissions: [], roles: [] };

  const isSuperAdmin = user.accessRoles.some((ur: any) => ur.role?.isSuperAdmin && ur.role?.isActive);
  if (isSuperAdmin) {
    return {
      companyId: user.companyId,
      isSuperAdmin: true,
      permissions: permissionCatalog().map((p) => p.key),
      deniedPermissions: [],
      roles: user.accessRoles.map((ur: any) => ({ id: ur.role.id, name: ur.role.name, title: ur.role.title, isSuperAdmin: ur.role.isSuperAdmin })),
    };
  }

  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const userRole of user.accessRoles) {
    if (!userRole.role?.isActive) continue;
    for (const rolePermission of userRole.role.permissions) {
      const key = rolePermission.permission.key;
      if (rolePermission.effect === 'DENY') deny.add(key);
      if (rolePermission.effect === 'ALLOW') allow.add(key);
    }
  }
  for (const override of user.permissionOverrides) {
    if (override.expiresAt && override.expiresAt < new Date()) continue;
    const key = override.permission.key;
    if (override.effect === 'DENY') deny.add(key);
    if (override.effect === 'ALLOW') allow.add(key);
  }
  for (const key of deny) allow.delete(key);

  return {
    companyId: user.companyId,
    isSuperAdmin: false,
    permissions: [...allow],
    deniedPermissions: [...deny],
    roles: user.accessRoles.map((ur: any) => ({ id: ur.role.id, name: ur.role.name, title: ur.role.title, isSuperAdmin: ur.role.isSuperAdmin })),
  };
}

export function hasPermission(access: EffectiveAccess | undefined, module: string, resource: string, action: AccessAction) {
  if (!access) return false;
  if (access.isSuperAdmin) return true;
  const exact = permissionKey(module, resource, action);
  const manage = permissionKey(module, resource, 'MANAGE');
  const moduleManage = moduleWildcardKey(module, 'MANAGE');
  const denied = new Set(access.deniedPermissions);
  if (denied.has(exact) || denied.has(manage) || denied.has(moduleManage)) return false;
  const allowed = new Set(access.permissions);
  if (resource === '*') {
    const moduleActionAllowed = access.permissions.some((key) => key.startsWith(`${module}:`) && (key.endsWith(`:${action}`.toLowerCase()) || key.endsWith(':manage')));
    const moduleActionDenied = access.deniedPermissions.some((key) => key.startsWith(`${module}:`) && (key.endsWith(`:${action}`.toLowerCase()) || key.endsWith(':manage')));
    return moduleActionAllowed && !moduleActionDenied;
  }
  return allowed.has(exact) || allowed.has(manage) || allowed.has(moduleManage);
}
