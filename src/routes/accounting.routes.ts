import { Router } from 'express';
import {
  getAccounts, getAccount, createAccount, updateAccount, deleteAccount,
  getJournalEntries, getJournalEntry, createJournalEntry, postJournalEntry, cancelJournalEntry, deleteJournalEntry,
  getFiscalYears, createFiscalYear,
  updatePeriod, getTrialBalance, getGLEntries, getProfitAndLoss, getBalanceSheet, getCashFlow, getBudgetVsActual,
  getCostCenters, createCostCenter, getBudgets, createBudget,
  createBankStatementLine, getBankStatementLines, reconcileBankLine, getBankReconciliation,
  getArApLedger, getTaxLedger, createPeriodClosingVoucher, submitPeriodClosingVoucher,
  getJournalTemplates, createJournalTemplate, createRecurringJournal,
  getFixedAssets, createFixedAsset, postAssetDepreciation,
} from '../controllers/accounting.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('accounting'));

router.route('/accounts').get(getAccounts).post(createAccount);
router.route('/accounts/:id').get(getAccount).put(updateAccount).delete(deleteAccount);

router.route('/journal-entries').get(getJournalEntries).post(createJournalEntry);
router.route('/journal-entries/:id').get(getJournalEntry).delete(deleteJournalEntry);
router.put('/journal-entries/:id/post', postJournalEntry);
router.put('/journal-entries/:id/cancel', cancelJournalEntry);

router.route('/fiscal-years').get(getFiscalYears).post(createFiscalYear);
router.put('/periods/:id', updatePeriod);

router.route('/cost-centers').get(getCostCenters).post(createCostCenter);
router.route('/budgets').get(getBudgets).post(createBudget);
router.route('/bank-statement-lines').get(getBankStatementLines).post(createBankStatementLine);
router.put('/bank-statement-lines/:id/reconcile', reconcileBankLine);
router.route('/period-closing-vouchers').post(createPeriodClosingVoucher);
router.put('/period-closing-vouchers/:id/submit', submitPeriodClosingVoucher);
router.route('/journal-templates').get(getJournalTemplates).post(createJournalTemplate);
router.post('/recurring-journals', createRecurringJournal);
router.route('/fixed-assets').get(getFixedAssets).post(createFixedAsset);
router.post('/fixed-assets/:id/depreciation', postAssetDepreciation);

router.get('/gl-entries', getGLEntries);
router.get('/trial-balance', getTrialBalance);
router.get('/reports/trial-balance', getTrialBalance);
router.get('/reports/general-ledger', getGLEntries);
router.get('/reports/profit-and-loss', getProfitAndLoss);
router.get('/reports/balance-sheet', getBalanceSheet);
router.get('/reports/cash-flow', getCashFlow);
router.get('/reports/budget-vs-actual', getBudgetVsActual);
router.get('/reports/bank-reconciliation', getBankReconciliation);
router.get('/reports/ar-ap-ledger', getArApLedger);
router.get('/reports/tax-ledger', getTaxLedger);

export default router;
