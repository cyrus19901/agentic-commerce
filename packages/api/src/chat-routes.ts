import { Router } from 'express';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import path from 'path';
type FirecrawlService = import('@agentic-commerce/integrations').FirecrawlService;
type FirecrawlX402Agent = import('@agentic-commerce/integrations').FirecrawlX402Agent;
type ZyteX402Agent = import('@agentic-commerce/integrations').ZyteX402Agent;
type EscrowService = import('@agentic-commerce/integrations').EscrowService;
type AuditService = import('@agentic-commerce/core').AuditService;

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ToolCallResult = {
  ok: boolean;
  data: unknown;
  status: number;
};

type CompletionResult = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
  }>;
};

const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://proxy.delphisecurity.ai/v1';
const DIRECT_OPENAI_BASE_URL = process.env.DIRECT_OPENAI_BASE_URL || 'https://api.openai.com/v1';
const DELPHI_FALLBACK_ENABLED = process.env.DELPHI_FALLBACK_ENABLED !== 'false';

const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'createUser',
      description: 'Create or get user account by email',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['email'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crawlPage',
      description: 'Scrape/crawl a web page URL using Firecrawl and return its content as markdown. Use this when the user wants to get data from a website or asks to crawl a page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to scrape' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchWeb',
      description: 'Search the web for information using Firecrawl. Returns relevant URLs and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkPolicy',
      description: 'Check if a payment/transaction is allowed by the policy engine. ONLY use this right before creating an escrow or making a payment. Do NOT use this before crawling or interacting with pages - those are free operations.',
      parameters: {
        type: 'object',
        properties: {
          user_email: { type: 'string' },
          price: { type: 'number', description: 'Amount in USD' },
          merchant: { type: 'string', description: 'Recipient/merchant name' },
          category: { type: 'string', description: 'Service category' },
          service_type: { type: 'string', description: 'Type of service (e.g. web-scraping, data-extraction)' },
          transaction_type: { type: 'string', enum: ['agent-to-merchant', 'agent-to-agent'], description: 'Type of transaction' },
        },
        required: ['price', 'merchant'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listPolicies',
      description: 'List all active policies or get details about specific policies',
      parameters: {
        type: 'object',
        properties: {
          user_email: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createEscrow',
      description: 'Create an on-chain Solana escrow (PDA) to hold USDC for a service payment. Policy check must pass first. The escrow PDA holds funds until service delivery. After creating, the user must sign a deposit transaction in their Phantom/Solflare wallet.',
      parameters: {
        type: 'object',
        properties: {
          payer_wallet: { type: 'string', description: 'Payer wallet address' },
          payee_wallet: { type: 'string', description: 'Payee/service provider wallet address' },
          amount: { type: 'number', description: 'Amount in USDC' },
          service_type: { type: 'string', description: 'Type of service being paid for' },
          description: { type: 'string', description: 'Description of the escrow' },
          user_email: { type: 'string' },
        },
        required: ['payer_wallet', 'payee_wallet', 'amount', 'service_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fundEscrow',
      description: 'Fund an existing escrow. For on-chain escrows, the deposit happens via the users wallet (Phantom signing). This tool records the deposit confirmation after the wallet transaction is submitted.',
      parameters: {
        type: 'object',
        properties: {
          escrow_id: { type: 'string' },
          transaction_hash: { type: 'string', description: 'On-chain transaction hash (optional for demo)' },
          user_email: { type: 'string' },
        },
        required: ['escrow_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'releaseEscrow',
      description: 'Release escrow funds on-chain to the payee (service provider) after service is delivered. This sends USDC from the escrow PDA to the providers wallet on Solana. Returns a settlement transaction link on Solana Explorer.',
      parameters: {
        type: 'object',
        properties: {
          escrow_id: { type: 'string' },
          user_email: { type: 'string' },
        },
        required: ['escrow_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getEscrowStatus',
      description: 'Get the current status and details of an escrow',
      parameters: {
        type: 'object',
        properties: {
          escrow_id: { type: 'string' },
          user_email: { type: 'string' },
        },
        required: ['escrow_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listEscrows',
      description: 'List all escrows, optionally filtered by status',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['created', 'funded', 'released', 'refunded', 'disputed', 'expired'] },
          user_email: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getAuditLog',
      description: 'View the audit trail - all tracked transactions, policy checks, escrow events, and web scraping activity',
      parameters: {
        type: 'object',
        properties: {
          event_type: { type: 'string', description: 'Filter by event type (e.g. escrow.created, policy.checked, firecrawl.scrape)' },
          limit: { type: 'number', description: 'Max entries to return' },
          user_email: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getWalletInfo',
      description: 'Get wallet information for the current user including balance and address',
      parameters: {
        type: 'object',
        properties: {
          user_email: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSpending',
      description: 'Get spending summary for the current user',
      parameters: {
        type: 'object',
        properties: {
          user_email: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'interactWithPage',
      description: 'Interact with a previously scraped page using natural language. The browser session stays open between calls so you can chain actions (click buttons, fill forms, navigate, extract data). You must call crawlPage first to get a scrapeId.',
      parameters: {
        type: 'object',
        properties: {
          scrape_id: { type: 'string', description: 'The scrapeId returned from crawlPage' },
          prompt: { type: 'string', description: 'Natural language instruction for what to do on the page (e.g. "Click on the Claude integration and tell me about it")' },
        },
        required: ['scrape_id', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stopSession',
      description: 'Stop a Firecrawl browser session when you are done interacting with it. Always call this after you finish to avoid unnecessary costs. This also signals that the service has been delivered and escrow can be released.',
      parameters: {
        type: 'object',
        properties: {
          scrape_id: { type: 'string', description: 'The scrapeId of the session to stop' },
        },
        required: ['scrape_id'],
      },
    },
  },
];

function getSystemPrompt(): string {
  return `You are an AI assistant for the Agentic Payments Settlement Platform - a production-grade system for policy-enforced agentic payments using the X402 protocol with on-chain Solana escrow settlement.

**Architecture:**
- **Policy Engine**: Checks spending policies before any payment
- **On-Chain Escrow (Solana)**: A real Solana program that holds USDC in a PDA until service delivery. Program ID: 5k5ZZHiar9aheemskLMc54Jx5niwKLmKMNySunsCyj9F
- **X402 Facilitator**: Verifies on-chain deposits and issues signed receipts
- **Firecrawl Agent**: A dedicated agent with its own wallet on Base (L2) that pays Firecrawl for scraping using the x402 payment protocol. The agent automatically handles the 402 challenge/response payment cycle on every request.
- **Dual-Chain Settlement**: User deposits USDC to Solana escrow, the Firecrawl Agent pays Firecrawl on Base via x402, results are returned, and the Solana escrow settles to the platform treasury.
- **Audit Trail**: Every action logged with both Solana Explorer links (user escrow) and BaseScan links (agent x402 payments)

**CRITICAL: Follow this flow step by step. NEVER skip steps. NEVER assume what the user wants.**

**Step 1 - Authentication & Wallet**:
Ask for the user's email. Also check if they have a Solana wallet connected (the UI sends wallet_address in the request). If no wallet is connected, tell them to click "Connect Wallet" in the header to connect Phantom or Solflare. Both email AND wallet are needed for the full flow.

**Step 2 - Understand intent**:
Ask what the user wants to do. For web scraping, ask which URL and what they want to find/interact with. NEVER assume.

**Step 3 - Policy check**:
Run checkPolicy with merchant "Firecrawl", service_type "web-scraping", price 0.50, transaction_type "agent-to-agent". Report the result.

**Step 4 - Create escrow**:
After policy passes, create an escrow using createEscrow. The escrow will be created on-chain as a Solana PDA that holds USDC. Tell the user: the escrow PDA address, the amount, and that they'll need to sign a USDC deposit transaction in their wallet.
Use the user's wallet_address for payer_wallet and "firecrawl-provider-wallet" for payee_wallet.

**Step 5 - Deposit (wallet signing)**:
The UI automatically handles wallet signing when you create an escrow with the right parameters. After creating the escrow, tell the user to approve the USDC deposit in their Phantom wallet popup. The UI will trigger the signing flow and confirm the deposit.

**Step 6 - Service delivery (Firecrawl Agent)**:
After deposit is confirmed, crawl the URL using crawlPage. The tool response will contain a "viaX402" field indicating whether the Firecrawl Agent paid via x402 on Base.
- If viaX402 is TRUE and baseTxHash is present: show the BaseScan link and explain the agent paid on Base.
- If viaX402 is FALSE: the scrape used the API key fallback. Do NOT mention any Base transaction or agent payment — just show the scrape results.
- NEVER fabricate or assume a Base transaction link. Only show one if baseTxHash is a real hash in the tool response.

**Step 7 - Interaction**:
Use interactWithPage for user-requested interactions. One action at a time.

**Step 8 - Settlement**:
When done, stop the session and release the escrow. The USDC moves from the escrow PDA to the service provider on-chain. Show the settlement transaction link on Solana Explorer.

**Step 9 - Audit trail**:
Offer to show the complete audit trail with all on-chain transaction links — both Solana (escrow) and Base (agent payments).

**RULES:**
1. NEVER call tools before having the user's email.
2. NEVER assume URLs or actions. Ask the user.
3. NEVER crawl without policy check + escrow first.
4. ONE STEP per response. Explain what happened, ask for input.
5. Share Solana Explorer links for escrow transactions. ONLY show BaseScan links when the tool response contains a real baseTxHash.
6. Use the wallet_address from the request for payer_wallet in escrow.
7. Explain what each step means in the settlement lifecycle.
8. If wallet is not connected, remind the user to connect it before payment steps.
9. NEVER fabricate transaction hashes or links. If viaX402 is false or baseTxHash is missing, do NOT mention any Base payment.
10. When the tool response shows viaX402: true with a baseTxHash, explain the dual-chain model: user deposited to Solana escrow, agent paid Firecrawl on Base.`;
}

async function callInternalApi(baseUrl: string, endpoint: string, payload: Record<string, unknown>): Promise<ToolCallResult> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep as text
  }
  return { ok: response.ok, data, status: response.status };
}

async function callInternalGet(baseUrl: string, endpoint: string, params?: Record<string, string>): Promise<ToolCallResult> {
  const url = new URL(`${baseUrl}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep as text
  }
  return { ok: response.ok, data, status: response.status };
}

async function executeTool(
  baseUrl: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  userEmail: string,
  services: {
    firecrawl: FirecrawlService;
    escrow: EscrowService;
    audit: AuditService;
  },
): Promise<ToolCallResult> {
  const merged: Record<string, unknown> = {
    ...toolArgs,
    user_email: (toolArgs.user_email as string | undefined) || userEmail,
  };

  switch (toolName) {
    case 'createUser':
      return callInternalApi(baseUrl, '/api/auth/create-user', merged);

    case 'crawlPage': {
      try {
        const result = await services.firecrawl.scrapeViaAgent(merged.url as string);

        services.audit.log({
          eventType: 'firecrawl.scrape',
          actor: userEmail,
          actorType: 'agent',
          resource: 'firecrawl',
          resourceId: merged.url as string,
          action: 'chat_scrape',
          outcome: 'success',
          details: {
            url: merged.url,
            title: result.title,
            contentLength: result.markdown.length,
            viaX402: result.viaX402,
            baseTxHash: result.baseTxHash,
            paymentAmount: result.paymentAmount,
            agentWallet: result.agentWallet,
          },
        });

        if (result.viaX402 && result.baseTxHash) {
          services.audit.log({
            eventType: 'firecrawl.x402.payment' as any,
            actor: result.agentWallet || 'firecrawl-agent',
            actorType: 'agent',
            resource: 'firecrawl-x402',
            resourceId: result.baseTxHash,
            action: 'x402_payment',
            outcome: 'success',
            details: {
              baseTxHash: result.baseTxHash,
              paymentAmount: result.paymentAmount,
              agentWallet: result.agentWallet,
              network: 'Base',
              baseScanUrl: `https://basescan.org/tx/${result.baseTxHash}`,
              url: merged.url,
            },
          });
        }

        const responseData: Record<string, unknown> = {
          ...result,
          paymentInfo: result.viaX402 && result.baseTxHash
            ? {
                method: 'x402',
                network: 'Base',
                baseTxHash: result.baseTxHash,
                baseScanUrl: `https://basescan.org/tx/${result.baseTxHash}`,
                paymentAmount: result.paymentAmount,
                agentWallet: result.agentWallet,
              }
            : {
                method: 'api_key',
                note: 'Scraped using Firecrawl API key. No blockchain payment was made for this request.',
              },
        };

        return { ok: true, data: responseData, status: 200 };
      } catch (error: any) {
        return { ok: false, data: { error: error.message }, status: 500 };
      }
    }

    case 'searchWeb': {
      try {
        const result = await services.firecrawl.searchViaAgent(merged.query as string, {
          limit: (merged.limit as number) || 5,
        });

        services.audit.log({
          eventType: 'firecrawl.search',
          actor: userEmail,
          actorType: 'agent',
          resource: 'firecrawl',
          action: 'chat_search',
          outcome: 'success',
          details: {
            query: merged.query,
            resultCount: result.results.length,
            viaX402: result.viaX402,
            baseTxHash: result.baseTxHash,
          },
        });

        if (result.viaX402 && result.baseTxHash) {
          services.audit.log({
            eventType: 'firecrawl.x402.payment' as any,
            actor: result.agentWallet || 'firecrawl-agent',
            actorType: 'agent',
            resource: 'firecrawl-x402',
            resourceId: result.baseTxHash,
            action: 'x402_search_payment',
            outcome: 'success',
            details: {
              baseTxHash: result.baseTxHash,
              paymentAmount: result.paymentAmount,
              agentWallet: result.agentWallet,
              network: 'Base',
              baseScanUrl: `https://basescan.org/tx/${result.baseTxHash}`,
              query: merged.query,
            },
          });
        }

        return { ok: true, data: result, status: 200 };
      } catch (error: any) {
        return { ok: false, data: { error: error.message }, status: 500 };
      }
    }

    case 'checkPolicy':
      return callInternalApi(baseUrl, '/api/policy/check', {
        ...merged,
        product_id: `svc-${(merged.service_type as string) || 'generic'}`,
      });

    case 'listPolicies':
      return callInternalGet(baseUrl, '/api/policies', { user_email: merged.user_email as string });

    case 'createEscrow': {
      // Override payer_wallet with the real connected wallet address if available
      if (merged._wallet_address && typeof merged._wallet_address === 'string') {
        merged.payer_wallet = merged._wallet_address;
      }
      return callInternalApi(baseUrl, '/api/escrow/create', merged);
    }

    case 'fundEscrow':
      return callInternalApi(baseUrl, `/api/escrow/${merged.escrow_id}/fund`, {
        transaction_hash: merged.transaction_hash || `sim_tx_${Date.now()}`,
        user_email: merged.user_email,
      });

    case 'releaseEscrow':
      return callInternalApi(baseUrl, `/api/escrow/${merged.escrow_id}/release`, {
        user_email: merged.user_email,
      });

    case 'getEscrowStatus': {
      return callInternalGet(baseUrl, `/api/escrow/${merged.escrow_id}`, {
        user_email: merged.user_email as string,
      });
    }

    case 'listEscrows':
      return callInternalGet(baseUrl, '/api/escrows', {
        status: merged.status as string,
        user_email: merged.user_email as string,
      });

    case 'getAuditLog': {
      const auditResult = services.audit.query({
        eventType: merged.event_type as any,
        limit: (merged.limit as number) || 20,
      });
      return { ok: true, data: auditResult, status: 200 };
    }

    case 'getWalletInfo':
      return callInternalGet(baseUrl, '/api/funding/account', {
        user_email: merged.user_email as string,
      });

    case 'getSpending':
      return callInternalApi(baseUrl, '/api/policy/spending', merged);

    case 'interactWithPage': {
      try {
        const result = await services.firecrawl.interact(merged.scrape_id as string, {
          prompt: merged.prompt as string,
        });
        services.audit.log({
          eventType: 'firecrawl.scrape',
          actor: userEmail,
          actorType: 'agent',
          resource: 'firecrawl-interact',
          resourceId: merged.scrape_id as string,
          action: 'interact',
          outcome: result.success ? 'success' : 'failure',
          details: {
            scrapeId: merged.scrape_id,
            prompt: (merged.prompt as string).substring(0, 200),
            hasLiveView: !!result.liveViewUrl,
          },
        });
        return { ok: result.success, data: result, status: result.success ? 200 : 500 };
      } catch (error: any) {
        return { ok: false, data: { error: error.message }, status: 500 };
      }
    }

    case 'stopSession': {
      try {
        const result = await services.firecrawl.stopSession(merged.scrape_id as string);
        services.audit.log({
          eventType: 'firecrawl.scrape',
          actor: userEmail,
          actorType: 'agent',
          resource: 'firecrawl-session',
          resourceId: merged.scrape_id as string,
          action: 'stop_session',
          outcome: result.success ? 'success' : 'failure',
          details: { scrapeId: merged.scrape_id },
        });
        return { ok: result.success, data: { ...result, scrapeId: merged.scrape_id, message: 'Session stopped. Service delivery complete.' }, status: 200 };
      } catch (error: any) {
        return { ok: false, data: { error: error.message }, status: 500 };
      }
    }

    default:
      return { ok: false, status: 400, data: { error: `Unsupported tool: ${toolName}` } };
  }
}

function isDelphiProxyUrl(url: string): boolean {
  return /proxy\.delphisecurity\.ai/i.test(url);
}

function buildDelphiChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

async function createCompletion(
  delphiOrApiKey: string,
  directOpenAIKey: string | undefined,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<CompletionResult> {
  if (isDelphiProxyUrl(OPENAI_BASE_URL)) {
    const delphiUrl = buildDelphiChatCompletionsUrl(OPENAI_BASE_URL);
    try {
      const response = await fetch(delphiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${delphiOrApiKey}`,
          'x-delphi-api-key': delphiOrApiKey,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          tools: TOOL_DEFS,
          tool_choice: 'auto',
          temperature: 0.3,
        }),
      });

      const raw = await response.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }

      if (!response.ok) {
        const err: any = new Error(parsed?.error?.message || parsed?.message || raw || `HTTP ${response.status}`);
        err.status = response.status;
        err.error = parsed || raw;
        throw err;
      }

      return parsed as CompletionResult;
    } catch (err: any) {
      const isProviderAuthFailure =
        err?.status === 401 ||
        String(err?.message || '').includes('provider_error') ||
        String(err?.message || '').includes('LLM provider returned 401');
      if (DELPHI_FALLBACK_ENABLED && directOpenAIKey && isProviderAuthFailure) {
        const directClient = new OpenAI({
          apiKey: directOpenAIKey,
          baseURL: DIRECT_OPENAI_BASE_URL,
        });
        return directClient.chat.completions.create({
          model: MODEL,
          messages,
          tools: TOOL_DEFS,
          tool_choice: 'auto',
          temperature: 0.3,
        });
      }
      throw err;
    }
  }

  const client = new OpenAI({
    apiKey: delphiOrApiKey,
    baseURL: OPENAI_BASE_URL,
  });
  return client.chat.completions.create({
    model: MODEL,
    messages,
    tools: TOOL_DEFS,
    tool_choice: 'auto',
    temperature: 0.3,
  });
}

function getUiHtml(): string {
  try {
    const htmlPath = path.resolve(__dirname, '../../../apps/chat-ui/index.html');
    return readFileSync(htmlPath, 'utf-8');
  } catch {
    // Fallback inline HTML if the file isn't found
  }
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agentic Payments Settlement Platform</title>
  <style>
    :root {
      --bg-primary: #0a0e1a;
      --bg-secondary: #111827;
      --bg-card: #1a1f35;
      --bg-input: #0d1225;
      --border: #2a3150;
      --border-active: #6366f1;
      --text-primary: #e2e8f0;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent: #6366f1;
      --accent-hover: #818cf8;
      --success: #10b981;
      --warning: #f59e0b;
      --error: #ef4444;
      --msg-user: #1e293b;
      --msg-assistant: #0f2b23;
      --msg-system: #1a1535;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-shrink: 0;
    }

    .header-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .header-brand .logo {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--accent), #a855f7);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
    }

    .header-brand h1 {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.3px;
    }

    .header-brand h1 span { color: var(--accent); }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    .email-input {
      padding: 7px 12px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-primary);
      font-size: 13px;
      width: 220px;
      outline: none;
      transition: border-color 0.2s;
    }

    .email-input:focus { border-color: var(--accent); }

    .btn {
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-primary);
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .btn:hover { background: var(--bg-secondary); border-color: var(--border-active); }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: white; }
    .btn-primary:hover { background: var(--accent-hover); }

    .status-pills {
      display: flex;
      gap: 6px;
      margin-left: 12px;
    }

    .pill {
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.3px;
    }

    .pill-policy { background: rgba(99,102,241,0.15); color: #a5b4fc; }
    .pill-x402 { background: rgba(16,185,129,0.15); color: #6ee7b7; }
    .pill-escrow { background: rgba(245,158,11,0.15); color: #fcd34d; }

    .main-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .messages::-webkit-scrollbar { width: 6px; }
    .messages::-webkit-scrollbar-track { background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

    .welcome {
      text-align: center;
      padding: 40px 20px;
      max-width: 600px;
      margin: auto;
    }

    .welcome h2 {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 10px;
    }

    .welcome p {
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 20px;
    }

    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
    }

    .quick-btn {
      padding: 8px 16px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-secondary);
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .quick-btn:hover {
      border-color: var(--accent);
      color: var(--text-primary);
      background: rgba(99,102,241,0.08);
    }

    .msg {
      max-width: 85%;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.65;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .msg-user {
      align-self: flex-end;
      background: var(--msg-user);
      border: 1px solid var(--border);
    }

    .msg-assistant {
      align-self: flex-start;
      background: var(--msg-assistant);
      border: 1px solid rgba(16,185,129,0.15);
    }

    .msg-system {
      align-self: center;
      background: var(--msg-system);
      border: 1px solid rgba(99,102,241,0.15);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .msg-error {
      align-self: center;
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.2);
      color: #fca5a5;
    }

    .msg-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 4px;
      opacity: 0.7;
    }

    .typing {
      align-self: flex-start;
      padding: 12px 20px;
      background: var(--msg-assistant);
      border: 1px solid rgba(16,185,129,0.15);
      border-radius: 12px;
      display: none;
    }

    .typing-dots {
      display: flex;
      gap: 4px;
    }

    .typing-dots span {
      width: 6px;
      height: 6px;
      background: var(--success);
      border-radius: 50%;
      animation: bounce 1.4s infinite;
    }

    .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    .composer {
      padding: 16px 24px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      display: flex;
      gap: 10px;
      align-items: flex-end;
      flex-shrink: 0;
    }

    .composer textarea {
      flex: 1;
      padding: 10px 14px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 14px;
      line-height: 1.5;
      resize: none;
      min-height: 44px;
      max-height: 120px;
      outline: none;
      transition: border-color 0.2s;
    }

    .composer textarea:focus { border-color: var(--accent); }

    .composer textarea::placeholder { color: var(--text-muted); }

    .send-btn {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      border: none;
      background: var(--accent);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
      flex-shrink: 0;
    }

    .send-btn:hover { background: var(--accent-hover); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .send-btn svg { width: 18px; height: 18px; }

    .live-view-panel {
      display: none;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      flex-shrink: 0;
      position: relative;
    }

    .live-view-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
    }

    .live-view-header span {
      font-size: 12px;
      font-weight: 600;
      color: var(--success);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .live-view-header span::before {
      content: '';
      width: 8px;
      height: 8px;
      background: var(--success);
      border-radius: 50%;
      animation: pulse-dot 2s infinite;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .live-view-close {
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-size: 11px;
      cursor: pointer;
    }

    .live-view-close:hover { border-color: var(--error); color: var(--error); }

    .live-view-panel iframe {
      width: 100%;
      height: 280px;
      border: none;
      background: #000;
    }

    @media (max-width: 640px) {
      .header { padding: 10px 14px; flex-wrap: wrap; }
      .status-pills { display: none; }
      .email-input { width: 160px; }
      .messages { padding: 14px; }
      .composer { padding: 12px 14px; }
      .msg { max-width: 95%; }
      .live-view-panel iframe { height: 200px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-brand">
      <div class="logo">AP</div>
      <h1><span>Agentic</span> Payments</h1>
    </div>
    <div class="status-pills">
      <span class="pill pill-policy">Policy Engine</span>
      <span class="pill pill-x402">X402</span>
      <span class="pill pill-escrow">Escrow</span>
    </div>
    <div class="header-controls">
      <input class="email-input" id="email" placeholder="your-email@example.com" />
      <button class="btn" id="saveEmail">Save</button>
      <button class="btn" id="clear">Clear</button>
    </div>
  </div>

  <div class="main-area">
    <div class="messages" id="messages">
      <div class="welcome" id="welcome">
        <h2>Agentic Payments Settlement</h2>
        <p>Demo platform for policy-enforced payments using X402 protocol with escrow settlement and full audit trail. Powered by Firecrawl for web data extraction.</p>
        <div class="quick-actions">
          <button class="quick-btn" data-msg="Crawl the Firecrawl integrations page and then interact with it - click on a few integrations and tell me what they do">Crawl + Interact</button>
          <button class="quick-btn" data-msg="Show me the active spending policies">View Policies</button>
          <button class="quick-btn" data-msg="Run the full demo: crawl a page, check policy, create escrow, fund it, interact with the page, stop the session, release escrow, and show the audit trail">Run Full Demo</button>
          <button class="quick-btn" data-msg="Show me the audit trail of all recent activity">View Audit Trail</button>
          <button class="quick-btn" data-msg="What is my wallet info and current spending?">Wallet &amp; Spending</button>
        </div>
      </div>
    </div>

    <div class="typing" id="typing">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>

    <div class="live-view-panel" id="liveViewPanel">
      <div class="live-view-header">
        <span>Live Browser View</span>
        <button class="live-view-close" id="closeLiveView">Close</button>
      </div>
      <iframe id="liveViewFrame" src="about:blank" sandbox="allow-scripts allow-same-origin"></iframe>
    </div>

    <div class="composer">
      <textarea id="input" placeholder="Ask me to crawl a page, check policies, create an escrow, or run the full demo..." rows="1"></textarea>
      <button class="send-btn" id="send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  </div>

  <script>
    const emailInput = document.getElementById('email');
    const input = document.getElementById('input');
    const messagesEl = document.getElementById('messages');
    const welcomeEl = document.getElementById('welcome');
    const typingEl = document.getElementById('typing');
    const sendBtn = document.getElementById('send');
    const liveViewPanel = document.getElementById('liveViewPanel');
    const liveViewFrame = document.getElementById('liveViewFrame');
    const closeLiveView = document.getElementById('closeLiveView');
    const history = [];
    let sending = false;

    emailInput.value = localStorage.getItem('chat_email') || '';

    closeLiveView.onclick = () => {
      liveViewPanel.style.display = 'none';
      liveViewFrame.src = 'about:blank';
    };

    function checkForLiveView(text) {
      const urlMatch = text.match(/https:\\/\\/liveview\\.firecrawl\\.dev\\/[^\\s)]+/);
      if (urlMatch) {
        liveViewFrame.src = urlMatch[0];
        liveViewPanel.style.display = 'block';
      }
    }

    function addMsg(role, text, cls) {
      if (welcomeEl) welcomeEl.style.display = 'none';
      const wrap = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'msg-label';
      label.textContent = role === 'user' ? 'You' : role === 'system' ? 'System' : 'Assistant';
      wrap.appendChild(label);

      const d = document.createElement('div');
      d.className = 'msg ' + (cls || (role === 'user' ? 'msg-user' : 'msg-assistant'));
      d.textContent = text;
      wrap.appendChild(d);

      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = role === 'user' ? 'flex-end' : cls === 'msg-system' ? 'center' : 'flex-start';
      wrap.style.maxWidth = '85%';
      wrap.style.alignSelf = role === 'user' ? 'flex-end' : cls === 'msg-system' || cls === 'msg-error' ? 'center' : 'flex-start';

      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      if (role === 'assistant') checkForLiveView(text);
    }

    document.getElementById('saveEmail').onclick = () => {
      const email = emailInput.value.trim();
      if (!email) return;
      localStorage.setItem('chat_email', email);
      addMsg('system', 'Email saved: ' + email, 'msg-system');
    };

    document.getElementById('clear').onclick = () => {
      history.length = 0;
      messagesEl.innerHTML = '';
      if (welcomeEl) {
        messagesEl.appendChild(welcomeEl);
        welcomeEl.style.display = '';
      }
    };

    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.onclick = () => {
        const msg = btn.getAttribute('data-msg');
        if (msg) {
          input.value = msg;
          doSend();
        }
      };
    });

    async function doSend() {
      if (sending) return;
      const message = input.value.trim();
      if (!message) return;
      const user_email = (emailInput.value || '').trim();
      if (!user_email) {
        addMsg('system', 'Please enter your email first.', 'msg-error');
        emailInput.focus();
        return;
      }

      addMsg('user', message, 'msg-user');
      history.push({ role: 'user', content: message });
      input.value = '';
      input.style.height = 'auto';
      sending = true;
      sendBtn.disabled = true;
      typingEl.style.display = 'block';
      messagesEl.scrollTop = messagesEl.scrollHeight;

      try {
        const res = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, user_email, history }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Chat request failed');
        addMsg('assistant', data.reply || '(no response)', 'msg-assistant');
        history.push({ role: 'assistant', content: data.reply || '' });
        if (data.liveViewUrl) {
          liveViewFrame.src = data.liveViewUrl;
          liveViewPanel.style.display = 'block';
        }
      } catch (e) {
        addMsg('system', String(e.message || e), 'msg-error');
      } finally {
        sending = false;
        sendBtn.disabled = false;
        typingEl.style.display = 'none';
      }
    }

    sendBtn.onclick = doSend;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  </script>
</body>
</html>`;
}

export function createChatRoutes(
  firecrawlService?: FirecrawlService,
  escrowService?: EscrowService,
  auditService?: AuditService,
  firecrawlX402Agent?: FirecrawlX402Agent,
  zyteX402Agent?: ZyteX402Agent,
) {
  const router = Router();
  const delphiKey = process.env.DELPHI_API_KEY;
  const directOpenAIKey = process.env.OPENAI_API_KEY;
  const openaiKey = delphiKey || directOpenAIKey;
  const systemPrompt = getSystemPrompt();

  if (firecrawlService) {
    if (firecrawlX402Agent) firecrawlService.setX402Agent(firecrawlX402Agent);
    if (zyteX402Agent) firecrawlService.setZyteAgent(zyteX402Agent);
  }

  const getServices = () => {
    const { FirecrawlService: FC, EscrowService: ES } = require('@agentic-commerce/integrations');
    const { AuditService: AS } = require('@agentic-commerce/core');
    return {
      firecrawl: firecrawlService || new FC(),
      escrow: escrowService || new ES(),
      audit: auditService || new AS(),
    };
  };

  router.get('/ui', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const html = getUiHtml().replace(/__API_BASE_URL__/g, baseUrl);
    res.type('html').send(html);
  });

  router.post('/send', async (req, res) => {
    try {
      if (!openaiKey) {
        return res.status(500).json({ error: 'DELPHI_API_KEY (or OPENAI_API_KEY) is not set' });
      }

      const { message, history = [], user_email, wallet_address } = req.body as {
        message?: string;
        history?: ChatMessage[];
        user_email?: string;
        wallet_address?: string;
      };

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required' });
      }
      if (!user_email || typeof user_email !== 'string') {
        return res.status(400).json({ error: 'user_email is required' });
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const services = getServices();
      let pendingDeposit: { escrowId: string; escrowPda: string; amount: number; needsSigning: boolean; payerWallet: string | null; payeeWallet: string | null } | null = null;
      let pendingLiveViewUrl: string | null = null;

      services.audit.log({
        eventType: 'chat.message',
        actor: user_email,
        actorType: 'user',
        resource: 'chat',
        action: 'send_message',
        outcome: 'success',
        details: { messageLength: message.length },
      });

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ];

      for (let i = 0; i < 10; i += 1) {
        const completion = await createCompletion(openaiKey, directOpenAIKey, messages);

        const msg = completion.choices?.[0]?.message;
        if (!msg) break;

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          const responsePayload: Record<string, unknown> = { reply: msg.content || '' };
          if (pendingDeposit) {
            responsePayload.depositAmount = pendingDeposit.amount;
            responsePayload.escrowId = pendingDeposit.escrowId;
            responsePayload.escrowPda = pendingDeposit.escrowPda;
            responsePayload.needsSigning = pendingDeposit.needsSigning;
            responsePayload.payerWallet = pendingDeposit.payerWallet;
            responsePayload.payeeWallet = pendingDeposit.payeeWallet;
          }
          if (pendingLiveViewUrl) {
            responsePayload.liveViewUrl = pendingLiveViewUrl;
          }
          return res.json(responsePayload);
        }

        messages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls,
        });

        for (const call of msg.tool_calls) {
          const toolName = call.function.name;
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(call.function.arguments || '{}');
          } catch {
            parsedArgs = {};
          }

          if (wallet_address) {
            parsedArgs._wallet_address = wallet_address;
          }

          const result = await executeTool(baseUrl, toolName, parsedArgs, user_email, services);

          const resultData = result.data as Record<string, unknown>;
          if (toolName === 'createEscrow' && result.ok && resultData?.escrow_id) {
            pendingDeposit = {
              escrowId: resultData.escrow_id as string,
              escrowPda: (resultData.escrow_pda as string) || (resultData.escrow_id as string),
              amount: (resultData.amount as number) || 0.5,
              needsSigning: (resultData.needs_signing as boolean) || false,
              payerWallet: (resultData.payer_wallet as string) || null,
              payeeWallet: (resultData.payee_wallet as string) || null,
            };
          }

          if (resultData?.liveViewUrl) {
            pendingLiveViewUrl = resultData.liveViewUrl as string;
          }

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: result.ok,
              status: result.status,
              data: result.data,
            }),
          });
        }
      }

      return res.status(500).json({ error: 'Model exceeded tool-call loop limit' });
    } catch (error: any) {
      const status = error?.status || error?.response?.status || 500;
      const detail =
        error?.error || error?.response?.data || error?.response?.body || error?.cause || null;

      if (process.env.NODE_ENV !== 'production') {
        return res.status(status).json({ error: error?.message || 'Chat failed', status, detail });
      }

      return res.status(status).json({ error: error?.message || 'Chat failed' });
    }
  });

  return router;
}
