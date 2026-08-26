import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, paginated } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';

export const getPayrolls = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { month, year, status, employeeId } = req.query as any;
    const where: any = { employee: { user: { companyId: (req as any).user?.companyId || '__missing_company__' } } };
    if (month) where.month = parseInt(month);
    if (year) where.year = parseInt(year);
    if (status) where.status = status;
    if (employeeId) where.employeeId = employeeId;

    const [items, total] = await Promise.all([
      prisma.payroll.findMany({
        where,
        include: {
          employee: { include: { user: { select: { firstName: true, lastName: true } } } },
          items: true,
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payroll.count({ where }),
    ]);
    return paginated(res, items, total, page, limit);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const generatePayroll = async (req: Request, res: Response) => {
  try {
    const { month, year } = req.body;
    const employees = await prisma.employee.findMany({
      where: { status: 'ACTIVE', user: { companyId: (req as any).user?.companyId || '__missing_company__' } },
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    const payrolls = await Promise.all(
      employees.map(async (emp) => {
        const existing = await prisma.payroll.findUnique({
          where: { employeeId_month_year: { employeeId: emp.id, month, year } },
        });
        if (existing) return existing;

        const tax = emp.salary * 0.1;
        const netSalary = emp.salary - tax;

        return prisma.payroll.create({
          data: {
            employeeId: emp.id, month, year,
            basicSalary: emp.salary, tax, netSalary,
            items: {
              create: [
                { type: 'EARNING', name: 'Basic Salary', amount: emp.salary },
                { type: 'TAX', name: 'Income Tax (10%)', amount: tax },
              ],
            },
          },
          include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } }, items: true },
        });
      })
    );

    return success(res, payrolls, 'Payroll generated', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updatePayrollStatus = async (req: Request, res: Response) => {
  try {
    const { status, payDate } = req.body;
    const payroll = await prisma.payroll.update({
      where: { id: req.params.id },
      data: { status, payDate: payDate ? new Date(payDate) : undefined },
    });
    return success(res, payroll, 'Payroll status updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
