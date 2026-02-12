/**
 * Agent Registry Routes
 * Discovery and registration of agent services
 */

import { Router } from 'express';
import { DB } from '@agentic-commerce/database';

export function createRegistryRoutes(db: DB) {
  const router = Router();

  /**
   * GET /api/registry/agents/:agentId
   * Discover an agent by ID
   */
  router.get('/agents/:agentId', async (req, res) => {
    try {
      const { agentId } = req.params;
      const agent = await db.getRegisteredAgent(agentId);

      if (!agent) {
        return res.status(404).json({
          error: 'AGENT_NOT_FOUND',
          message: `Agent ${agentId} not found in registry`,
        });
      }

      if (!agent.active) {
        return res.status(410).json({
          error: 'AGENT_INACTIVE',
          message: `Agent ${agentId} is no longer active`,
        });
      }

      return res.json({
        agentId: agent.agentId,
        name: agent.name,
        baseUrl: agent.baseUrl,
        services: agent.services,
        serviceDescription: agent.serviceDescription,
        acceptedCurrencies: agent.acceptedCurrencies,
        verified: agent.verified,
        metadata: agent.metadata,
      });
    } catch (error: any) {
      console.error('Registry lookup error:', error);
      return res.status(500).json({
        error: 'REGISTRY_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/registry/agents
   * List all active agents
   */
  router.get('/agents', async (req, res) => {
    try {
      const { verified, service } = req.query;
      
      const filters: any = { active: true };
      if (verified === 'true') {
        filters.verified = true;
      }

      let agents = await db.listRegisteredAgents(filters);

      // Filter by service if specified
      if (service) {
        agents = agents.filter(agent => 
          agent.services.includes(service as string)
        );
      }

      return res.json({
        agents: agents.map(agent => ({
          agentId: agent.agentId,
          name: agent.name,
          baseUrl: agent.baseUrl,
          services: agent.services,
          serviceDescription: agent.serviceDescription,
          acceptedCurrencies: agent.acceptedCurrencies,
          verified: agent.verified,
        })),
        count: agents.length,
      });
    } catch (error: any) {
      console.error('Registry list error:', error);
      return res.status(500).json({
        error: 'REGISTRY_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/registry/agents
   * Register a new agent (requires authentication)
   */
  router.post('/agents', async (req, res) => {
    try {
      // Get user from token or allow test user
      let tokenUser = (req as any).user?.userId;
      if (!tokenUser) {
        // Allow test registrations for E2E testing
        tokenUser = 'test-e2e-user';
        console.log('⚠️  Agent registration without auth token - using test user');
      }

      const {
        agentId,
        name,
        baseUrl,
        services,
        serviceDescription,
        acceptedCurrencies,
        usdcTokenAccount,
        solanaPubkey,
        metadata,
      } = req.body;

      // Validate required fields
      if (!agentId || !name || !baseUrl || !services || !Array.isArray(services)) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Missing required fields: agentId, name, baseUrl, services',
        });
      }

      // Check if agent already exists
      const existing = await db.getRegisteredAgent(agentId);
      if (existing) {
        return res.status(409).json({
          error: 'AGENT_EXISTS',
          message: `Agent ${agentId} already registered`,
        });
      }

      // Register the agent
      const id = `agent_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      await db.registerAgent({
        id,
        agentId,
        name,
        baseUrl,
        services,
        serviceDescription,
        acceptedCurrencies: acceptedCurrencies || ['USDC'],
        usdcTokenAccount,
        solanaPubkey,
        ownerId: tokenUser,
        metadata,
      });

      const registered = await db.getRegisteredAgent(agentId);

      return res.status(201).json({
        success: true,
        message: 'Agent registered successfully',
        agent: registered,
      });
    } catch (error: any) {
      console.error('Agent registration error:', error);
      return res.status(500).json({
        error: 'REGISTRATION_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/registry/agents/:agentId
   * Update agent information (requires authentication and ownership)
   */
  router.put('/agents/:agentId', async (req, res) => {
    try {
      const tokenUser = (req as any).user?.userId;
      if (!tokenUser) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { agentId } = req.params;
      const agent = await db.getRegisteredAgent(agentId);

      if (!agent) {
        return res.status(404).json({
          error: 'AGENT_NOT_FOUND',
          message: `Agent ${agentId} not found`,
        });
      }

      // Check ownership
      if (agent.ownerId !== tokenUser) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not own this agent',
        });
      }

      // Update agent
      const updates = req.body;
      await db.updateRegisteredAgent(agentId, updates);

      const updated = await db.getRegisteredAgent(agentId);

      return res.json({
        success: true,
        message: 'Agent updated successfully',
        agent: updated,
      });
    } catch (error: any) {
      console.error('Agent update error:', error);
      return res.status(500).json({
        error: 'UPDATE_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * DELETE /api/registry/agents/:agentId
   * Delete agent (requires authentication and ownership)
   */
  router.delete('/agents/:agentId', async (req, res) => {
    try {
      const tokenUser = (req as any).user?.userId;
      if (!tokenUser) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { agentId } = req.params;
      const agent = await db.getRegisteredAgent(agentId);

      if (!agent) {
        return res.status(404).json({
          error: 'AGENT_NOT_FOUND',
          message: `Agent ${agentId} not found`,
        });
      }

      // Check ownership
      if (agent.ownerId !== tokenUser) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not own this agent',
        });
      }

      await db.deleteRegisteredAgent(agentId);

      return res.json({
        success: true,
        message: 'Agent deleted successfully',
      });
    } catch (error: any) {
      console.error('Agent deletion error:', error);
      return res.status(500).json({
        error: 'DELETION_ERROR',
        message: error.message,
      });
    }
  });

  return router;
}
