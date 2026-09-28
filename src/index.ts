import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import compression from 'compression';

dotenv.config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters');
}

import authRoutes from './routes/auth.routes';
import accountingRoutes from './routes/accounting.routes';
import inventoryRoutes from './routes/inventory.routes';
import hrRoutes from './routes/hr.routes';
import crmRoutes from './routes/crm.routes';
import salesRoutes from './routes/sales.routes';
import invoicingRoutes from './routes/invoicing.routes';
import invoicingExtrasRoutes from './routes/invoicing-extras.routes';
import invoicesRoutes from './routes/invoices.routes';
import paymentsRoutes from './routes/payments.routes';
import productsRoutes from './routes/products.routes';
import salesOrdersRoutes from './routes/sales-orders.routes';
import deliveryNotesRoutes from './routes/delivery-notes.routes';
import procurementRoutes from './routes/procurement.routes';
import projectsRoutes from './routes/projects.routes';
import customersRoutes from './routes/customers.routes';
import suppliersRoutes from './routes/suppliers.routes';
import dashboardRoutes from './routes/dashboard.routes';
import accessRoutes from './routes/access.routes';
import notificationRoutes from './routes/notifications.routes';
import platformRoutes from './routes/platform.routes';
import incentiveRoutes from './routes/incentives.routes';
import tallyRoutes from './routes/tally.routes';
import tallyAgentRoutes from './routes/tallyAgent.routes';
import { idempotency, mutationAudit, requestContext } from './middleware/platform';
import { runDueSubscriptionsJob } from './controllers/invoicingExtras.controller';
import prisma from './lib/prisma';
import { workOne } from './services/platform/job.service';
import { processCrmReminders } from './services/crm/jobs';
import { processSalesCommitmentAlerts, processSalesExpiry } from './services/sales/jobs';
import { processInventoryMonitoring } from './services/inventory/jobs';
import { processProcurementMonitoring } from './services/procurement/jobs';

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression({ threshold: 1024 }));

const normalizeOrigin = (value: string) => value.trim().replace(/\/$/, '');
const configuredOrigins = [
  process.env.FRONTEND_URL,
  process.env.MARKETING_URL,
  process.env.CORS_ORIGINS,
]
  .filter(Boolean)
  .flatMap((value) => String(value).split(','))
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedExplicitOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:8081',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:8081',
  'https://erp-frontend-green.vercel.app',
  ...configuredOrigins,
]);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (e.g. mobile apps, server-to-server, curl, Postman)
      if (!origin) return callback(null, true);

      const normalized = normalizeOrigin(origin);
      if (allowedExplicitOrigins.has(normalized)) {
        return callback(null, true);
      }

      try {
        const parsed = new URL(origin);
        const host = parsed.hostname;

        if (host === 'localhost' || host === '127.0.0.1') {
          return callback(null, true);
        }
      } catch {
        // Fall through
      }

      return callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestContext);
app.use(mutationAudit);

app.use('/api/auth', authRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/invoicing', invoicingRoutes);
app.use('/api/invoicing', invoicingExtrasRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/sales-orders', salesOrdersRoutes);
app.use('/api/delivery-notes', deliveryNotesRoutes);
app.use('/api/procurement', procurementRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/incentives', incentiveRoutes);
app.use('/api/tally', tallyRoutes);
app.use('/api/tally/agent', tallyAgentRoutes);

// Versioned API is canonical. Legacy /api mounts remain during client migration.
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/access', accessRoutes);
app.use('/api/v1/accounting', accountingRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/hr', hrRoutes);
app.use('/api/v1/crm', crmRoutes);
app.use('/api/v1/sales', salesRoutes);
app.use('/api/v1/invoicing', invoicingRoutes);
app.use('/api/v1/invoicing', invoicingExtrasRoutes);
app.use('/api/v1/invoices', invoicesRoutes);
app.use('/api/v1/payments', paymentsRoutes);
app.use('/api/v1/products', productsRoutes);
app.use('/api/v1/sales-orders', salesOrdersRoutes);
app.use('/api/v1/delivery-notes', deliveryNotesRoutes);
app.use('/api/v1/procurement', procurementRoutes);
app.use('/api/v1/projects', projectsRoutes);
app.use('/api/v1/customers', customersRoutes);
app.use('/api/v1/suppliers', suppliersRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/incentives', incentiveRoutes);
app.use('/api/v1/tally', tallyRoutes);
app.use('/api/v1/tally/agent', tallyAgentRoutes);
app.use('/api/v1/platform', platformRoutes);

app.get('/health', (req, res) => {
  prisma.$queryRaw`SELECT 1`
    .then(() => res.json({ status: 'OK', database: 'OK', timestamp: new Date(), version: '1.0.0' }))
    .catch(() => res.status(503).json({ status: 'DEGRADED', database: 'UNAVAILABLE', timestamp: new Date(), version: '1.0.0' }));
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled request error:', err);
  if (res.headersSent) return;
  res.status(err?.message === 'Origin is not allowed by CORS' ? 403 : 500).json({
    success: false,
    message: err?.message === 'Origin is not allowed by CORS' ? err.message : 'Internal server error',
  });
});

const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, () => {
  console.log(`Nishit ERP Server running at http://${HOST}:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  const detail = err.code === 'EADDRINUSE'
    ? `Port ${PORT} is already in use. Stop the existing process or set a different PORT.`
    : err.code === 'EACCES' || err.code === 'EPERM'
      ? `Cannot bind to ${HOST}:${PORT}. Check host permissions or use HOST=127.0.0.1.`
      : err.message;
  console.error(`HTTP server failed to start: ${detail}`);
  process.exitCode = 1;
});

if (process.env.ENABLE_RECURRING_INVOICE_SCHEDULER === 'true') {
  setInterval(() => {
    runDueSubscriptionsJob().catch((err) => console.error('Recurring invoice scheduler failed', err));
  }, 60 * 60 * 1000);
}

if (process.env.ENABLE_BACKGROUND_WORKER !== 'false') {
  const guarded = (name: string, task: () => Promise<unknown>) => {
    let running = false;
    return async () => {
      if (running) return;
      running = true;
      try { await task(); }
      catch (err) { console.error(`${name} failed`, err); }
      finally { running = false; }
    };
  };
  const workBackgroundJobs = guarded('Background job worker', () => workOne());
  const workCrmReminders = guarded('CRM reminder worker', () => processCrmReminders());
  const workSalesExpiry = guarded('Sales expiry worker', () => processSalesExpiry());
  const workSalesCommitments = guarded('Sales commitment alert worker', () => processSalesCommitmentAlerts());
  const workInventoryMonitoring = guarded('Inventory monitoring worker', () => processInventoryMonitoring());
  const workProcurementMonitoring = guarded('Procurement monitoring worker', () => processProcurementMonitoring());

  // Run each worker once on startup so due delivery and stock alerts are not
  // delayed by an hour after a deploy or process restart.
  void workBackgroundJobs();
  void workCrmReminders();
  void workSalesExpiry();
  void workSalesCommitments();
  void workInventoryMonitoring();
  void workProcurementMonitoring();

  setInterval(workBackgroundJobs, 15_000);
  setInterval(workCrmReminders, 60_000);
  setInterval(workSalesExpiry, 60_000);
  setInterval(workSalesCommitments, 60 * 60 * 1000);
  // Stock-ledger postings alert immediately; this sweep also catches changes
  // caused by reservations/imports and reconciles recovered stock promptly.
  setInterval(workInventoryMonitoring, 5 * 60 * 1000);
  setInterval(workProcurementMonitoring, 60 * 60 * 1000);
}

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; closing HTTP server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});

export default app;
