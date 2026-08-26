import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { success } from '../../utils/response';
import { handlePrismaError } from '../../utils/prismaError';

export const getCrmDashboard = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const staleDate = new Date(now);
    staleDate.setDate(staleDate.getDate() - 7);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [
      leads,
      leadSources,
      opportunities,
      activities,
      activityTypeCounts,
      overdueActivities,
      dueTodayActivities,
      staleLeads,
      hotLeads,
      recentOpportunities,
    ] = await Promise.all([
      prisma.lead.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.lead.groupBy({ by: ['source'], _count: { id: true } }),
      prisma.opportunity.findMany({ select: { id: true, title: true, stage: true, value: true, probability: true, expectedClose: true, currency: true, createdAt: true } }),
      prisma.activity.findMany({
        where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } },
        include: {
          lead: { select: { id: true, title: true } },
          opportunity: { select: { id: true, title: true } },
          user: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      prisma.activity.groupBy({ by: ['type'], where: { createdAt: { gte: yearStart } }, _count: { id: true } }),
      prisma.activity.count({ where: { status: { in: ['PLANNED', 'IN_PROGRESS'] }, dueDate: { lt: now } } }),
      prisma.activity.count({ where: { status: { in: ['PLANNED', 'IN_PROGRESS'] }, dueDate: { lte: todayEnd, gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } } }),
      prisma.lead.count({
        where: {
          status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] },
          OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: staleDate } }],
        },
      }),
      prisma.lead.findMany({
        where: { status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } },
        select: {
          id: true, title: true, firstName: true, lastName: true, company: true, source: true, status: true, priority: true, value: true, score: true, lastContactedAt: true,
          assignedTo: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: [{ score: 'desc' }, { value: 'desc' }, { updatedAt: 'desc' }],
        take: 8,
      }),
      prisma.opportunity.findMany({
        select: {
          id: true, title: true, stage: true, value: true, probability: true, currency: true, expectedClose: true,
          organization: { select: { name: true } },
          customer: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
    ]);

    const leadCounts = Object.fromEntries(leads.map((row) => [row.status, row._count.id]));
    const sourceCounts = leadSources.map((row) => ({ source: row.source, count: row._count.id }));
    const pipeline = opportunities.reduce((acc: any, opp) => {
      const row = acc[opp.stage] || { count: 0, value: 0, weightedValue: 0 };
      row.count += 1;
      row.value += Number(opp.value || 0);
      row.weightedValue += Number(opp.value || 0) * (Number(opp.probability || 0) / 100);
      acc[opp.stage] = row;
      return acc;
    }, {});
    const pipelineTrend = opportunities.reduce((acc: any[], opportunity) => {
      const date = opportunity.createdAt;
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const row = acc.find((item) => item.month === month) || { month, count: 0, value: 0, weightedValue: 0 };
      row.count += 1;
      row.value += Number(opportunity.value || 0);
      row.weightedValue += Number(opportunity.value || 0) * (Number(opportunity.probability || 0) / 100);
      if (!acc.includes(row)) acc.push(row);
      return acc;
    }, []).sort((a, b) => a.month.localeCompare(b.month));
    const won = pipeline.CLOSED_WON?.count || 0;
    const lost = pipeline.CLOSED_LOST?.count || 0;
    const converted = leadCounts.CONVERTED || 0;
    const totalLeads = Object.values(leadCounts).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
    const openPipelineValue = Object.entries(pipeline)
      .filter(([stage]) => !['CLOSED_WON', 'CLOSED_LOST'].includes(stage))
      .reduce((sum, [, row]: any) => sum + row.value, 0);
    const weightedPipelineValue = Object.entries(pipeline)
      .filter(([stage]) => !['CLOSED_WON', 'CLOSED_LOST'].includes(stage))
      .reduce((sum, [, row]: any) => sum + row.weightedValue, 0);

    return success(res, {
      leadCounts,
      sourceCounts,
      totalLeads,
      conversionRate: totalLeads ? Math.round((converted / totalLeads) * 100) : 0,
      winRate: won + lost ? Math.round((won / (won + lost)) * 100) : 0,
      pipeline,
      pipelineTrend,
      openPipelineValue,
      weightedPipelineValue,
      overdueActivities,
      dueTodayActivities,
      staleLeads,
      activityMix: activityTypeCounts.map((row) => ({ type: row.type, count: row._count.id })),
      hotLeads,
      recentOpportunities,
      upcomingActivities: activities,
    });
  } catch (err: any) {
    return handlePrismaError(res, err);
  }
};
