import { describe, expect, it } from 'vitest';
import { applyTenantToPrismaArgs, runWithTenant, tenantModels } from './tenant';

describe('tenant enforcement', () => {
  it('overwrites untrusted companyId on create', () => runWithTenant({ tenantId: 'tenant-a', companyId: 'company-a' }, () => {
    expect(applyTenantToPrismaArgs('Product', 'create', { data: { companyId: 'company-b', name: 'X' } }).data.companyId).toBe('company-a');
  }));
  it('forces companyId on reads and mutations', () => runWithTenant({ tenantId: 'tenant-a', companyId: 'company-a' }, () => {
    for (const model of tenantModels) {
      expect(applyTenantToPrismaArgs(model, 'findMany', { where: { companyId: 'company-b' } }).where.companyId).toBe('company-a');
      expect(applyTenantToPrismaArgs(model, 'updateMany', { where: { companyId: 'company-b' }, data: {} }).where.companyId).toBe('company-a');
    }
  }));
});
