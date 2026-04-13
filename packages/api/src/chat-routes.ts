import { Router } from 'express';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import path from 'path';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ToolCallResult = {
  ok: boolean;
  data: unknown;
  status: number;
};

const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://proxy.delphisecurity.ai/v1';
const DIRECT_OPENAI_BASE_URL = process.env.DIRECT_OPENAI_BASE_URL || 'https://api.openai.com/v1';
const DELPHI_FALLBACK_ENABLED = process.env.DELPHI_FALLBACK_ENABLED !== 'false';

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
      name: 'searchProducts',
      description: 'Search products by query, price, category',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_price: { type: 'number' },
          category: { type: 'string' },
          limit: { type: 'number' },
          user_email: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkPolicy',
      description: 'Check if purchase is allowed by policies',
      parameters: {
        type: 'object',
        properties: {
          user_email: { type: 'string' },
          product_id: { type: 'string' },
          price: { type: 'number' },
          merchant: { type: 'string' },
          category: { type: 'string' },
          transaction_type: { type: 'string' },
          service_type: { type: 'string' },
        },
        required: ['product_id', 'price', 'merchant'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSpending',
      description: 'Get user spending summary',
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
      name: 'initiateCheckout',
      description: 'Initiate checkout session for purchase',
      parameters: {
        type: 'object',
        properties: {
          user_email: { type: 'string' },
          product_id: { type: 'string' },
          product_name: { type: 'string' },
          amount: { type: 'number' },
          merchant: { type: 'string' },
          category: { type: 'string' },
          transaction_type: { type: 'string' },
          service_type: { type: 'string' },
          product_url: { type: 'string' },
          product_image_url: { type: 'string' },
        },
        required: ['product_id', 'product_name', 'amount', 'merchant'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'completeCheckout',
      description: 'Finalize checkout after payment',
      parameters: {
        type: 'object',
        properties: {
          user_email: { type: 'string' },
          session_id: { type: 'string' },
          user_id: { type: 'string' },
          product_id: { type: 'string' },
          product_name: { type: 'string' },
          amount: { type: 'number' },
          merchant: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['session_id'],
      },
    },
  },
];

function getSystemPrompt(): string {
  const fallback = [
    'You are an AI commerce assistant.',
    'Ask for user email first if missing.',
    'Always run policy checks before checkout.',
    'Use tools for all commerce actions.',
  ].join('\n');

  try {
    const fullPath = path.resolve(__dirname, '../../../docs/CHATGPT_INSTRUCTIONS_UNIFIED.md');
    const raw = readFileSync(fullPath, 'utf8');
    const start = raw.indexOf('```');
    const end = raw.lastIndexOf('```');
    if (start >= 0 && end > start) {
      return raw.slice(start + 3, end).trim();
    }
    return raw.trim();
  } catch {
    return fallback;
  }
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
    // Keep plain text response
  }
  return { ok: response.ok, data, status: response.status };
}

async function executeTool(
  baseUrl: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  userEmail: string
): Promise<ToolCallResult> {
  const merged = {
    ...toolArgs,
    user_email: (toolArgs.user_email as string | undefined) || userEmail,
  };

  switch (toolName) {
    case 'createUser':
      return callInternalApi(baseUrl, '/api/auth/create-user', merged);
    case 'searchProducts':
      return callInternalApi(baseUrl, '/api/products/search', merged);
    case 'checkPolicy':
      return callInternalApi(baseUrl, '/api/policy/check', merged);
    case 'getSpending':
      return callInternalApi(baseUrl, '/api/policy/spending', merged);
    case 'initiateCheckout':
      return callInternalApi(baseUrl, '/api/checkout/initiate', merged);
    case 'completeCheckout':
      return callInternalApi(baseUrl, '/api/checkout/complete', merged);
    default:
      return {
        ok: false,
        status: 400,
        data: { error: `Unsupported tool: ${toolName}` },
      };
  }
}

function isDelphiProxyUrl(url: string): boolean {
  return /proxy\.delphisecurity\.ai/i.test(url);
}

function buildDelphiChatCompletionsUrl(baseUrl: string): string {
  // Delphi docs use:
  //   <proxy>/v1/chat/completions
  // where proxy can be either:
  //   https://proxy.delphisecurity.ai
  // or
  //   https://.../functions/v1/ai-proxy
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

async function createCompletion(
  delphiOrApiKey: string,
  directOpenAIKey: string | undefined,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
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
      // Optional automatic failover if Delphi provider is unavailable/auth failing.
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
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agentic Commerce Chat</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    .wrap { max-width: 900px; margin: 0 auto; padding: 16px; }
    .bar { display: flex; gap: 8px; margin-bottom: 12px; }
    input, button, textarea { border-radius: 8px; border: 1px solid #334155; background: #111827; color: #e5e7eb; }
    input { padding: 10px; flex: 1; }
    #messages { height: 70vh; overflow: auto; border: 1px solid #334155; border-radius: 12px; padding: 12px; background: #020617; }
    .msg { margin: 8px 0; padding: 10px; border-radius: 10px; white-space: pre-wrap; }
    .u { background: #1e293b; }
    .a { background: #0b3b2f; }
    .err { background: #4c0519; }
    .composer { display: flex; gap: 8px; margin-top: 12px; }
    textarea { flex: 1; min-height: 60px; padding: 10px; resize: vertical; }
    button { padding: 10px 14px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="bar">
      <input id="email" placeholder="your email (for user context)" />
      <button id="saveEmail">Save</button>
      <button id="clear">Clear Chat</button>
    </div>
    <div id="messages"></div>
    <div class="composer">
      <textarea id="input" placeholder="Ask to find/buy something..."></textarea>
      <button id="send">Send</button>
    </div>
  </div>
  <script>
    const emailInput = document.getElementById('email');
    const input = document.getElementById('input');
    const messagesEl = document.getElementById('messages');
    const history = [];
    emailInput.value = localStorage.getItem('chat_email') || '';

    function add(role, text, cls) {
      const d = document.createElement('div');
      d.className = 'msg ' + (cls || (role === 'user' ? 'u' : 'a'));
      d.textContent = text;
      messagesEl.appendChild(d);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    document.getElementById('saveEmail').onclick = () => {
      localStorage.setItem('chat_email', emailInput.value.trim());
      add('assistant', 'Email saved for this browser.');
    };

    document.getElementById('clear').onclick = () => {
      history.length = 0;
      messagesEl.innerHTML = '';
    };

    async function send() {
      const message = input.value.trim();
      if (!message) return;
      const user_email = (emailInput.value || '').trim();
      if (!user_email) {
        add('assistant', 'Please enter an email first.', 'err');
        return;
      }
      add('user', message, 'u');
      history.push({ role: 'user', content: message });
      input.value = '';

      try {
        const res = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, user_email, history })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Chat request failed');
        add('assistant', data.reply || '(no response)', 'a');
        history.push({ role: 'assistant', content: data.reply || '' });
      } catch (e) {
        add('assistant', String(e.message || e), 'err');
      }
    }

    document.getElementById('send').onclick = send;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  </script>
</body>
</html>`;
}

export function createChatRoutes() {
  const router = Router();
  const delphiKey = process.env.DELPHI_API_KEY;
  // This key is used for direct provider fallback when Delphi proxy is unavailable.
  const directOpenAIKey = process.env.OPENAI_API_KEY;
  const openaiKey = delphiKey || directOpenAIKey;
  const systemPrompt = getSystemPrompt();

  router.get('/ui', (_req, res) => {
    res.type('html').send(getUiHtml());
  });

  router.post('/send', async (req, res) => {
    try {
      if (!openaiKey) {
        return res.status(500).json({ error: 'DELPHI_API_KEY (or OPENAI_API_KEY) is not set' });
      }

      const { message, history = [], user_email } = req.body as {
        message?: string;
        history?: ChatMessage[];
        user_email?: string;
      };

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required' });
      }
      if (!user_email || typeof user_email !== 'string') {
        return res.status(400).json({ error: 'user_email is required' });
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ];

      for (let i = 0; i < 8; i += 1) {
        const completion = await createCompletion(openaiKey, directOpenAIKey, messages);

        const msg = completion.choices?.[0]?.message;
        if (!msg) break;

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          return res.json({ reply: msg.content || '' });
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

          const result = await executeTool(baseUrl, toolName, parsedArgs, user_email);
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
      // Surface upstream proxy/provider details in development for faster debugging.
      const status = error?.status || error?.response?.status || 500;
      const detail =
        error?.error ||
        error?.response?.data ||
        error?.response?.body ||
        error?.cause ||
        null;

      if (process.env.NODE_ENV !== 'production') {
        return res.status(status).json({
          error: error?.message || 'Chat failed',
          status,
          detail,
        });
      }

      return res.status(status).json({ error: error?.message || 'Chat failed' });
    }
  });

  return router;
}
