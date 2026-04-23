/**
 * Agent Registry Routes
 * Discovery and registration of agent services
 */

import { Router } from 'express';
import { DB } from '@agentic-commerce/database';
import { executeProviderTool, fetchProviderX402Price, normalizeProviderConfig } from './archtools-adapter';
import { hydrateProviderSecret, redactProviderSecrets, secureProviderMetadata, validateProviderSchema } from './provider-security';

function extractToolMapFromOpenApi(spec: any): Record<string, string> {
  const toolMap: Record<string, string> = {};
  const paths = spec?.paths || {};
  for (const [path, methods] of Object.entries(paths)) {
    for (const [verb, op] of Object.entries((methods as any) || {})) {
      if (!['post', 'get', 'put', 'patch', 'delete'].includes(verb.toLowerCase())) continue;
      const operation = op as any;
      const operationId = String(operation?.operationId || '').trim();
      const pathMatch = String(path).match(/\/tools\/([^/]+)/);
      const providerTool = pathMatch?.[1] || operationId;
      if (!providerTool) continue;
      if (providerTool.includes('web-scrape')) toolMap.scrape = providerTool;
      if (providerTool.includes('web-search')) toolMap['api-call'] = providerTool;
      if (providerTool.includes('ai-oracle')) toolMap['data-analysis'] = providerTool;
      if (providerTool.includes('research-report')) toolMap['advanced-analysis'] = providerTool;
    }
  }
  return toolMap;
}

function extractAllProviderToolsFromOpenApi(spec: any): string[] {
  const tools = new Set<string>();
  const paths = spec?.paths || {};
  for (const path of Object.keys(paths)) {
    const pathMatch = String(path).match(/\/tools\/([^/]+)/);
    if (pathMatch?.[1]) tools.add(pathMatch[1]);
  }
  return Array.from(tools).sort();
}

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
        metadata: redactProviderSecrets(agent.metadata),
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

      if (metadata?.provider) {
        const providerErrors = validateProviderSchema(metadata.provider);
        if (providerErrors.length > 0) {
          return res.status(400).json({
            error: 'INVALID_PROVIDER_SCHEMA',
            details: providerErrors,
          });
        }
      }
      const safeMetadata = secureProviderMetadata(metadata);

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
        metadata: safeMetadata,
      });

      const registered = await db.getRegisteredAgent(agentId);

      return res.status(201).json({
        success: true,
        message: 'Agent registered successfully',
        agent: registered ? { ...registered, metadata: redactProviderSecrets(registered.metadata) } : null,
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
      if (updates?.metadata?.provider) {
        const providerErrors = validateProviderSchema(updates.metadata.provider);
        if (providerErrors.length > 0) {
          return res.status(400).json({
            error: 'INVALID_PROVIDER_SCHEMA',
            details: providerErrors,
          });
        }
        updates.metadata = secureProviderMetadata(updates.metadata);
      }
      await db.updateRegisteredAgent(agentId, updates);

      const updated = await db.getRegisteredAgent(agentId);

      return res.json({
        success: true,
        message: 'Agent updated successfully',
        agent: updated ? { ...updated, metadata: redactProviderSecrets(updated.metadata) } : null,
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

  /**
   * POST /api/registry/agents/:agentId/discover-tools
   * Ingest provider OpenAPI and auto-populate provider.toolMap.
   */
  router.post('/agents/:agentId/discover-tools', async (req, res) => {
    try {
      let tokenUser = (req as any).user?.userId;
      if (!tokenUser) {
        // Maintain compatibility with current unauthenticated registry mount in dev.
        tokenUser = 'test-e2e-user';
      }
      const { agentId } = req.params;
      const { openapiUrl } = req.body;
      if (!openapiUrl || typeof openapiUrl !== 'string') {
        return res.status(400).json({ error: 'openapiUrl is required' });
      }

      const agent = await db.getRegisteredAgent(agentId);
      if (!agent) return res.status(404).json({ error: 'AGENT_NOT_FOUND' });
      if (agent.ownerId !== tokenUser) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not own this agent' });
      }

      const response = await fetch(openapiUrl);
      if (!response.ok) {
        return res.status(400).json({ error: 'OPENAPI_FETCH_FAILED', status: response.status });
      }
      const spec = await response.json();
      const discoveredToolMap = extractToolMapFromOpenApi(spec);
      const discoveredProviderTools = extractAllProviderToolsFromOpenApi(spec);
      if (Object.keys(discoveredToolMap).length === 0) {
        return res.status(400).json({
          error: 'DISCOVERY_EMPTY',
          message: 'Could not infer tool mappings from provided OpenAPI',
        });
      }

      const metadata = { ...(agent.metadata || {}) };
      metadata.provider = {
        ...(metadata.provider || {}),
        openapiUrl,
        discoveredTools: discoveredProviderTools,
        toolMap: {
          ...((metadata.provider && metadata.provider.toolMap) || {}),
          ...discoveredToolMap,
        },
      };
      const providerErrors = validateProviderSchema(metadata.provider);
      if (providerErrors.length > 0) {
        return res.status(400).json({ error: 'INVALID_PROVIDER_SCHEMA', details: providerErrors });
      }
      await db.updateRegisteredAgent(agentId, { metadata: secureProviderMetadata(metadata) });
      const updated = await db.getRegisteredAgent(agentId);

      return res.json({
        success: true,
        discoveredCount: Object.keys(discoveredToolMap).length,
        discoveredProviderToolCount: discoveredProviderTools.length,
        discoveredProviderTools,
        toolMap: discoveredToolMap,
        agent: updated ? { ...updated, metadata: redactProviderSecrets(updated.metadata) } : null,
      });
    } catch (error: any) {
      console.error('Tool discovery error:', error);
      return res.status(500).json({
        error: 'DISCOVERY_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/registry/agents/:agentId/services/catalog
   * Return all provider services discovered from OpenAPI + current mapped internal services.
   */
  router.get('/agents/:agentId/services/catalog', async (req, res) => {
    try {
      const { agentId } = req.params;
      const openapiUrlFromQuery = req.query.openapi_url as string | undefined;
      const agent = await db.getRegisteredAgent(agentId);
      if (!agent) return res.status(404).json({ error: 'AGENT_NOT_FOUND' });

      const providerRaw = hydrateProviderSecret(agent?.metadata?.provider);
      const openapiUrl = openapiUrlFromQuery || providerRaw?.openapiUrl;
      if (!openapiUrl) {
        return res.status(400).json({
          error: 'OPENAPI_URL_REQUIRED',
          message: 'Provide ?openapi_url=... or set metadata.provider.openapiUrl',
        });
      }
      const response = await fetch(openapiUrl);
      if (!response.ok) {
        return res.status(400).json({ error: 'OPENAPI_FETCH_FAILED', status: response.status });
      }
      const spec = await response.json();
      const providerTools = extractAllProviderToolsFromOpenApi(spec);
      const mappedToolMap = (providerRaw?.toolMap || {}) as Record<string, string>;
      const mappedInternalServices = Object.keys(mappedToolMap);

      return res.json({
        success: true,
        agentId,
        openapiUrl,
        providerToolCount: providerTools.length,
        providerTools,
        mappedInternalServiceCount: mappedInternalServices.length,
        mappedInternalServices,
        toolMap: mappedToolMap,
      });
    } catch (error: any) {
      console.error('Service catalog error:', error);
      return res.status(500).json({
        error: 'SERVICE_CATALOG_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/registry/agents/:agentId/sync-services
   * Sync registered_agents.services from provider.toolMap keys.
   */
  router.post('/agents/:agentId/sync-services', async (req, res) => {
    try {
      let tokenUser = (req as any).user?.userId;
      if (!tokenUser) tokenUser = 'test-e2e-user';
      const { agentId } = req.params;
      const mode = req.body?.mode === 'replace' ? 'replace' : 'merge';

      const agent = await db.getRegisteredAgent(agentId);
      if (!agent) return res.status(404).json({ error: 'AGENT_NOT_FOUND' });
      if (agent.ownerId !== tokenUser) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not own this agent' });
      }

      const providerRaw = hydrateProviderSecret(agent?.metadata?.provider);
      const mappedServices = Object.keys((providerRaw?.toolMap || {}) as Record<string, string>);
      if (mappedServices.length === 0) {
        return res.status(400).json({
          error: 'NO_MAPPED_SERVICES',
          message: 'No provider.toolMap entries found. Run discover-tools first or provide toolMap.',
        });
      }

      const currentServices: string[] = Array.isArray(agent.services) ? agent.services : [];
      const nextServices = mode === 'replace'
        ? Array.from(new Set(mappedServices))
        : Array.from(new Set([...currentServices, ...mappedServices]));

      await db.updateRegisteredAgent(agentId, { services: nextServices });
      const updated = await db.getRegisteredAgent(agentId);
      return res.json({
        success: true,
        mode,
        beforeCount: currentServices.length,
        discoveredMappedCount: mappedServices.length,
        afterCount: nextServices.length,
        services: nextServices,
        agent: updated ? { ...updated, metadata: redactProviderSecrets(updated.metadata) } : null,
      });
    } catch (error: any) {
      console.error('Sync services error:', error);
      return res.status(500).json({
        error: 'SYNC_SERVICES_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/registry/agents/:agentId/provider/test
   * One-click provider onboarding verification: pricing + sample tool execution.
   */
  router.post('/agents/:agentId/provider/test', async (req, res) => {
    try {
      const { agentId } = req.params;
      const { serviceType = 'scrape', sampleInput } = req.body || {};
      const agent = await db.getRegisteredAgent(agentId);
      if (!agent) return res.status(404).json({ error: 'AGENT_NOT_FOUND' });

      const providerRaw = hydrateProviderSecret(agent?.metadata?.provider);
      const provider = normalizeProviderConfig(providerRaw);
      if (!provider) {
        return res.status(400).json({
          error: 'PROVIDER_NOT_CONFIGURED',
          message: 'Agent metadata.provider is not configured correctly',
        });
      }

      const pricingResult =
        provider.pricingStrategy === 'x402'
          ? await fetchProviderX402Price(serviceType, provider)
          : null;

      const input =
        sampleInput ||
        (serviceType === 'scrape' || serviceType === 'data-scraping'
          ? { url: 'https://example.com', format: 'markdown' }
          : { prompt: 'Return exactly ok', model: 'gpt-4o-mini', max_tokens: 8 });
      const execution = await executeProviderTool(serviceType, input, provider);

      return res.json({
        success: true,
        agentId,
        provider: provider.name,
        serviceType,
        pricing: pricingResult
          ? {
              amountAtomic: pricingResult.amountAtomic,
              amountUsd: pricingResult.amountUsd,
              tool: pricingResult.tool,
            }
          : null,
        execution,
      });
    } catch (error: any) {
      console.error('Provider test error:', error);
      return res.status(500).json({
        error: 'PROVIDER_TEST_ERROR',
        message: error.message,
      });
    }
  });

  return router;
}
