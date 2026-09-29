import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { error } from '../utils/response';

export interface AgentAuthRequest extends Request {
  tallyConnection?: {
    id: string;
    companyId: string;
    tenantId: string;
    label: string | null;
  };
}

export const agentAuthenticate = async (req: AgentAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const apiKey = req.headers['x-agent-key'] as string;
  
  if (!apiKey) {
    error(res, 'Agent API key missing', 401);
    return;
  }

  try {
    // In a production system, we'd look up the API key using a prefix or a cached lookup.
    // Since we only have the hash, and bcrypt is slow, doing a linear scan across all connections is bad.
    // For this implementation, the API key format will be: `connectionId.plaintextKey`
    const [connectionId, plainTextSecret] = apiKey.split('.');
    
    if (!connectionId || !plainTextSecret) {
      error(res, 'Invalid agent API key format. Expected connectionId.secret', 401);
      return;
    }

    const connection = await prisma.tallyConnection.findUnique({
      where: { id: connectionId },
      include: { company: { select: { tenantId: true } } }
    });

    if (!connection || !connection.isActive) {
      error(res, 'Agent connection not found or inactive', 401);
      return;
    }

    const isMatch = await bcrypt.compare(plainTextSecret, connection.agentApiKeyHash);
    if (!isMatch) {
      error(res, 'Invalid agent API key', 401);
      return;
    }

    req.tallyConnection = {
      id: connection.id,
      companyId: connection.companyId,
      tenantId: connection.company.tenantId,
      label: connection.label
    };
    
    next();
  } catch (err: any) {
    console.error('Agent authentication error:', err);
    error(res, 'Agent authentication failed', 500);
  }
};
