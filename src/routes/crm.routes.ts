import { Router } from 'express';
import {
  getLeads, getLead, createLead, updateLead, deleteLead, convertLead, previewLeadImport, importLeads, getLeadImports, getLeadImport,
  qualifyLead, markLeadLost,
  getContacts, getContact, createContact, updateContact, deleteContact, openLeadContact,
  getOpportunities, getOpportunity, createOpportunity, updateOpportunity, deleteOpportunity, getPipeline, createOpportunityErpDocs,
  getActivities, getLeadActivities, createActivity, createLeadActivity, updateActivity, completeActivity, cancelActivity, deleteActivity,
  getOrganizations, getOrganization, createOrganization, updateOrganization, deleteOrganization,
  getCrmDashboard, getSavedViews, createSavedView, deleteSavedView,
  getAssignmentRules, createAssignmentRule, updateAssignmentRule, deleteAssignmentRule, testAssignmentRule,
  checkDuplicateLead, mergeLeads, assignLead, bulkAssignLeads, getLeadTimeline,
  createScopeRule, listScopeRules, deleteScopeRule, listLostReasons, createLostReason, updateLostReason,
  getCrmConfiguration, updateDefaultQueue,
  moveOpportunityStage, winOpportunity, loseOpportunity, opportunityHistory,
  myDay, overdueActivities, activityCalendar, addActivityAttendees, createDailyDigest,
  listEmailTemplates, createEmailTemplate, sendCommunication, communicationThread, syncMailbox,
  deleteEmailTemplate, revokeCaptureToken,
  listIntegrationAccounts, connectIntegrationAccount, disconnectIntegrationAccount,
  createCaptureToken, listCaptureTokens, captureLead, inboundCommunicationWebhook,
  requestLeadExport, getExport, crmReport,
} from '../controllers/crm.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use((req, _res, next) => { req.body ||= {}; next(); });
router.post('/capture/leads', captureLead);
router.post('/capture/web-to-lead', captureLead);
router.post('/webhooks/indiamart', captureLead);
router.post('/webhooks/facebook-leads', captureLead);
router.post('/webhooks/communications', inboundCommunicationWebhook);
router.post('/webhooks/whatsapp', inboundCommunicationWebhook);
router.use(authenticate);
router.use(requireModuleAccess('crm'));

router.get('/dashboard', getCrmDashboard);

router.post('/leads/import/preview', previewLeadImport);
router.post('/leads/check-duplicate', checkDuplicateLead);
router.post('/leads/bulk-assign', bulkAssignLeads);
router.post('/leads/export', requestLeadExport);
router.post('/leads/import', importLeads);
router.get('/leads/imports', getLeadImports);
router.get('/leads/imports/:id', getLeadImport);
router.route('/leads').get(getLeads).post(createLead);
router.post('/leads/:id/qualify', qualifyLead);
router.post('/leads/:id/merge', mergeLeads);
router.post('/leads/:id/assign', assignLead);
router.get('/leads/:id/timeline', getLeadTimeline);
router.post('/leads/:id/mark-lost', markLeadLost);
router.post('/leads/:id/convert', convertLead);
router.post('/leads/:id/contact', openLeadContact);
router.route('/leads/:id/activities').get(getLeadActivities).post(createLeadActivity);
router.route('/leads/:id').get(getLead).put(updateLead).delete(deleteLead);

router.route('/assignment-rules').get(getAssignmentRules).post(createAssignmentRule);
router.post('/assignment-rules/test', testAssignmentRule);
router.route('/assignment-rules/:id').put(updateAssignmentRule).patch(updateAssignmentRule).delete(deleteAssignmentRule);

router.route('/organizations').get(getOrganizations).post(createOrganization);
router.route('/organizations/:id').get(getOrganization).put(updateOrganization).delete(deleteOrganization);

router.route('/contacts').get(getContacts).post(createContact);
router.route('/contacts/:id').get(getContact).put(updateContact).delete(deleteContact);

router.get('/opportunities/pipeline', getPipeline);
router.route('/opportunities').get(getOpportunities).post(createOpportunity);
router.post('/opportunities/:id/create-erp-docs', createOpportunityErpDocs);
router.post('/opportunities/:id/quotation', createOpportunityErpDocs);
router.post('/opportunities/:id/stage', moveOpportunityStage);
router.post('/opportunities/:id/win', winOpportunity);
router.post('/opportunities/:id/lose', loseOpportunity);
router.get('/opportunities/:id/stage-history', opportunityHistory);
router.route('/opportunities/:id').get(getOpportunity).put(updateOpportunity).patch(updateOpportunity).delete(deleteOpportunity);

router.route('/activities').get(getActivities).post(createActivity);
router.get('/activities-my-day', myDay);
router.get('/activities-overdue', overdueActivities);
router.get('/activities-calendar', activityCalendar);
router.post('/activities/daily-digest', createDailyDigest);
router.post('/activities/:id/attendees', addActivityAttendees);
router.put('/activities/:id/complete', completeActivity);
router.put('/activities/:id/cancel', cancelActivity);
router.route('/activities/:id').put(updateActivity).delete(deleteActivity);

router.route('/saved-views').get(getSavedViews).post(createSavedView);
router.delete('/saved-views/:id', deleteSavedView);

router.route('/scope-rules').get(listScopeRules).post(createScopeRule);
router.delete('/scope-rules/:id', deleteScopeRule);
router.get('/configuration', getCrmConfiguration);
router.put('/configuration/default-queue', updateDefaultQueue);
router.route('/lost-reasons').get(listLostReasons).post(createLostReason);
router.patch('/lost-reasons/:id', updateLostReason);
router.route('/email-templates').get(listEmailTemplates).post(createEmailTemplate);
router.delete('/email-templates/:id', deleteEmailTemplate);
router.route('/communications').get(communicationThread).post(sendCommunication);
router.post('/communications/sync', syncMailbox);
router.route('/integrations').get(listIntegrationAccounts).post(connectIntegrationAccount);
router.delete('/integrations/:id', disconnectIntegrationAccount);
router.route('/capture-tokens').get(listCaptureTokens).post(createCaptureToken);
router.delete('/capture-tokens/:id', revokeCaptureToken);
router.get('/exports/:id', getExport);
router.get('/reports/:type', crmReport);

export default router;
