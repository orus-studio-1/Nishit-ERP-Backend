import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success, error } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';
import { serializeMoney } from '../../utils/invoice';

export const getLedgerEntries = async (req: Request, res: Response) => {
  try {
    const { invoiceId, paymentEntryId, creditNoteId, accountId } = req.query as any;
    const entries = await prisma.generalLedgerEntry.findMany({
      where: { invoiceId, paymentEntryId, creditNoteId, accountId },
      include: { account: { select: { code: true, name: true, type: true } } },
      orderBy: { postingDate: 'desc' },
    });
    return success(res, entries.map((entry: any) => ({ ...entry, debit: serializeMoney(entry.debit), credit: serializeMoney(entry.credit) })));
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

const defaultTemplate = {
  title: 'Tax Invoice',
  sections: ['letterhead', 'customer', 'items', 'taxes', 'totals', 'terms', 'footer'],
  showLogo: true,
  showHsnSummary: true,
  showAmountInWords: true,
  showPaymentTerms: true,
};

export const getPrintFormats = async (req: Request, res: Response) => {
  try {
    const { docType, isActive } = req.query as any;
    const where: any = {};
    if (docType) where.docType = docType;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    const formats = await prisma.printFormat.findMany({ where, orderBy: [{ docType: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }] });
    return success(res, formats);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const createPrintFormat = async (req: Request, res: Response) => {
  try {
    if (!req.body.name) return error(res, 'Print format name is required', 400);
    const docType = req.body.docType || 'SALES_INVOICE';
    const format = await prisma.$transaction(async (tx) => {
      if (req.body.isDefault) await tx.printFormat.updateMany({ where: { docType }, data: { isDefault: false } });
      return tx.printFormat.create({
        data: {
          name: req.body.name,
          docType,
          isDefault: !!req.body.isDefault,
          isActive: req.body.isActive ?? true,
          template: req.body.template || defaultTemplate,
          letterhead: req.body.letterhead,
          footer: req.body.footer,
        },
      });
    });
    return success(res, format, 'Print format created', 201);
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};

export const updatePrintFormat = async (req: Request, res: Response) => {
  try {
    const existing = await prisma.printFormat.findUnique({ where: { id: req.params.id } });
    if (!existing) return error(res, 'Print format not found', 404);
    const format = await prisma.$transaction(async (tx) => {
      if (req.body.isDefault) await tx.printFormat.updateMany({ where: { docType: existing.docType }, data: { isDefault: false } });
      return tx.printFormat.update({
        where: { id: existing.id },
        data: {
          name: req.body.name ?? existing.name,
          isDefault: req.body.isDefault ?? existing.isDefault,
          isActive: req.body.isActive ?? existing.isActive,
          template: req.body.template ?? existing.template,
          letterhead: req.body.letterhead ?? existing.letterhead,
          footer: req.body.footer ?? existing.footer,
        },
      });
    });
    return success(res, format, 'Print format updated');
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
