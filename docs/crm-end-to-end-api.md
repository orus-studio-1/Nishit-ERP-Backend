# CRM end-to-end API

All authenticated endpoints use `/api/v1/crm`. Public capture endpoints require `x-capture-token`.

## Leads

- `POST /leads/check-duplicate`
- `POST /leads/:id/merge`
- `POST /leads/:id/assign`
- `POST /leads/bulk-assign`
- `POST /leads/:id/qualify`
- `POST /leads/:id/mark-lost` with `lostReasonId`
- `GET /leads/:id/timeline`
- `POST /leads/import/preview`, `POST /leads/import`
- `POST /leads/export`, `GET /exports/:id`

## Scope and assignment

- `GET|POST /scope-rules`, `DELETE /scope-rules/:id`
- Scope values: `OWN`, `TEAM`, `BRANCH`, `ALL`
- Assignment rules accept source, city, country, territory, productId, branchId, value range and priority.
- Set platform setting namespace `crm`, key `defaultQueueUserId` for unmatched leads.

## Opportunity workflow

- `POST /opportunities/:id/stage`
- `POST /opportunities/:id/win`
- `POST /opportunities/:id/lose` with `lostReasonId`
- `GET /opportunities/:id/stage-history`
- `POST /opportunities/:id/quotation`
- `POST /opportunities/:id/create-erp-docs` with `createSalesOrder: true` after winning

## Activities and communication

- `GET /activities-my-day`, `/activities-overdue`, `/activities-calendar?from=&to=`
- `POST /activities/:id/attendees`
- `POST /activities/daily-digest`
- Activities accept `outcome`, `reminderAt`, `recurrenceRule` (`DAILY`, `WEEKLY`, `MONTHLY`) and `recurrenceEnd`.
- `GET|POST /email-templates`
- `GET|POST /communications`, `POST /communications/sync`
- `GET|POST /integrations`, `DELETE /integrations/:id` for Gmail, Outlook, IMAP and WhatsApp credentials

Provider jobs use `CRM_MESSAGE_GATEWAY_URL`, `CRM_MESSAGE_GATEWAY_TOKEN`, `WHATSAPP_API_URL`, `WHATSAPP_ACCESS_TOKEN`, `CRM_MAIL_SYNC_URL`, and `CRM_MAIL_SYNC_TOKEN`.

## Capture and webhooks

- `GET|POST /capture-tokens`
- `POST /capture/leads`, `/capture/web-to-lead`
- `POST /webhooks/indiamart`, `/webhooks/facebook-leads`
- `POST /webhooks/whatsapp`, `/webhooks/communications`

## Reports

`GET /reports/:type`, where type is `summary`, `conversion-funnel`, `sales-rep-leaderboard`, `source-campaign`, `lead-ageing`, `weighted-pipeline`, `lost-reasons`, or `activity-performance`.
