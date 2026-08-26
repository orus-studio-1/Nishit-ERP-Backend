import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { serializeMoney } from '../../utils/invoice';

const D = Prisma.Decimal;

export const getTaxTemplates = async (_req: Request, res: Response) => {
  try {
    const templates = await prisma.taxTemplate.findMany({ include: { lines: { orderBy: { rowOrder: 'asc' } } }, orderBy: { name: 'asc' } });
    return success(res, templates.map((template: any) => ({
      ...template,
      lines: template.lines.map((line: any) => ({ ...line, rate: serializeMoney(line.rate) })),
    })));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createTaxTemplate = async (req: Request, res: Response) => {
  try {
    const { lines = [], ...data } = req.body;
    if (!data.name || !data.code) return error(res, 'Name and code are required', 400);
    if (!lines.length) return error(res, 'At least one tax row is required', 400);
    for (const line of lines) {
      if (!line.label) return error(res, 'Every tax row needs a label', 400);
      if (Number(line.rate || 0) < 0) return error(res, 'Tax rate cannot be negative', 400);
    }
    const template = await prisma.taxTemplate.create({
      data: {
        ...data,
        lines: {
          create: lines.map((line: any, index: number) => ({
            label: line.label,
            rate: new D(line.rate || 0),
            chargeType: line.chargeType || 'ON_NET_TOTAL',
            rowOrder: line.rowOrder ?? index,
            accountId: line.accountId,
            isRecoverable: !!line.isRecoverable,
          })),
        },
      },
      include: { lines: true },
    });
    return success(res, template, 'Tax template created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updateTaxTemplate = async (req: Request, res: Response) => {
  try {
    const { lines, ...data } = req.body;
    if (lines) {
      if (!lines.length) return error(res, 'At least one tax row is required', 400);
      for (const line of lines) {
        if (!line.label) return error(res, 'Every tax row needs a label', 400);
        if (Number(line.rate || 0) < 0) return error(res, 'Tax rate cannot be negative', 400);
      }
    }
    const template = await prisma.$transaction(async (tx) => {
      if (lines) await tx.taxTemplateLine.deleteMany({ where: { taxTemplateId: req.params.id } });
      return tx.taxTemplate.update({
        where: { id: req.params.id },
        data: {
          ...data,
          ...(lines ? { lines: { create: lines.map((line: any, index: number) => ({ label: line.label, rate: new D(line.rate || 0), chargeType: line.chargeType || 'ON_NET_TOTAL', rowOrder: line.rowOrder ?? index, accountId: line.accountId, isRecoverable: !!line.isRecoverable })) } } : {}),
        },
        include: { lines: true },
      });
    });
    return success(res, template, 'Tax template updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
