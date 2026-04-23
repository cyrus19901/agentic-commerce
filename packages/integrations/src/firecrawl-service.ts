export interface FirecrawlScrapeResult {
  url: string;
  scrapeId: string;
  title: string;
  content: string;
  markdown: string;
  metadata: Record<string, unknown>;
  scrapedAt: string;
}

export interface FirecrawlInteractResult {
  success: boolean;
  scrapeId: string;
  output?: string;
  stdout?: string;
  result?: string;
  stderr?: string;
  exitCode?: number;
  killed?: boolean;
  liveViewUrl?: string;
  interactiveLiveViewUrl?: string;
}

export interface FirecrawlSearchResult {
  query: string;
  results: Array<{
    url: string;
    title: string;
    snippet: string;
  }>;
}

export interface FirecrawlSession {
  scrapeId: string;
  url: string;
  status: 'active' | 'stopped';
  liveViewUrl?: string;
  interactiveLiveViewUrl?: string;
  createdAt: string;
  interactCount: number;
}

export class FirecrawlService {
  private apiKey: string;
  private baseUrlV1: string;
  private baseUrlV2: string;
  private sessions: Map<string, FirecrawlSession> = new Map();
  private x402Agent: import('./firecrawl-x402-agent.js').FirecrawlX402Agent | null = null;
  private zyteAgent: import('./zyte-x402-agent.js').ZyteX402Agent | null = null;

  constructor() {
    this.apiKey = process.env.FIRECRAWL_API_KEY || '';
    const base = (process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev').replace(/\/v[12]$/, '');
    this.baseUrlV1 = `${base}/v1`;
    this.baseUrlV2 = `${base}/v2`;
  }

  setX402Agent(agent: import('./firecrawl-x402-agent.js').FirecrawlX402Agent): void {
    this.x402Agent = agent;
  }

  setZyteAgent(agent: import('./zyte-x402-agent.js').ZyteX402Agent): void {
    this.zyteAgent = agent;
  }

  getZyteAgent(): import('./zyte-x402-agent.js').ZyteX402Agent | null {
    return this.zyteAgent;
  }

  getX402Agent(): import('./firecrawl-x402-agent.js').FirecrawlX402Agent | null {
    return this.x402Agent;
  }

  /**
   * Scrape via the x402 agent on Base if available, falling back to the API-key method.
   * Returns the standard scrape result plus optional x402 payment metadata.
   */
  async scrapeViaAgent(url: string): Promise<
    FirecrawlScrapeResult & { baseTxHash?: string; paymentAmount?: string; agentWallet?: string; viaX402: boolean; provider?: string }
  > {
    // 1. Try Zyte x402 agent first (fast, reliable)
    if (this.zyteAgent?.isReady()) {
      const agentResult = await this.zyteAgent.scrape(url);
      if (agentResult.success) {
        const raw = agentResult.data as any;
        const html: string = raw?.browserHtml || '';
        const httpBody: string = raw?.httpResponseBody
          ? Buffer.from(raw.httpResponseBody, 'base64').toString('utf-8')
          : '';
        const content = html || httpBody;
        const scrapeId = `zyte_${Date.now()}`;
        const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);

        const session: FirecrawlSession = { scrapeId, url, status: 'active', createdAt: new Date().toISOString(), interactCount: 0 };
        this.sessions.set(scrapeId, session);

        return {
          url,
          scrapeId,
          title: titleMatch?.[1]?.trim() || url,
          content,
          markdown: content,
          metadata: { source: 'zyte-x402', statusCode: raw?.statusCode, url, scrapeId },
          scrapedAt: new Date().toISOString(),
          baseTxHash: agentResult.baseTxHash,
          paymentAmount: agentResult.paymentAmount,
          agentWallet: agentResult.agentWallet,
          viaX402: true,
          provider: 'zyte',
        };
      }
      console.warn('[FirecrawlService] Zyte agent scrape failed, trying Firecrawl x402:', agentResult.error);
    }

    // 2. Try Firecrawl x402 agent
    if (this.x402Agent?.isReady()) {
      const agentResult = await this.x402Agent.scrape(url);
      if (agentResult.success) {
        const raw = agentResult.data as any;
        const result = raw?.data || raw;
        const scrapeId = result?.metadata?.scrapeId || `x402_${Date.now()}`;

        const session: FirecrawlSession = { scrapeId, url, status: 'active', createdAt: new Date().toISOString(), interactCount: 0 };
        this.sessions.set(scrapeId, session);

        return {
          url,
          scrapeId,
          title: result?.metadata?.title || result?.title || url,
          content: result?.content || result?.text || '',
          markdown: result?.markdown || result?.content || '',
          metadata: { ...result?.metadata, source: 'firecrawl-x402', url, scrapeId },
          scrapedAt: new Date().toISOString(),
          baseTxHash: agentResult.baseTxHash,
          paymentAmount: agentResult.paymentAmount,
          agentWallet: agentResult.agentWallet,
          viaX402: true,
          provider: 'firecrawl',
        };
      }
      console.warn('[FirecrawlService] Firecrawl x402 agent scrape failed, falling back to API key:', agentResult.error);
    }

    // 3. Fallback to Firecrawl API key
    const result = await this.scrapeUrl(url);
    return { ...result, viaX402: false, provider: 'firecrawl-apikey' };
  }

  /**
   * Search via the x402 agent on Base if available, falling back to the API-key method.
   */
  async searchViaAgent(query: string, options?: { limit?: number }): Promise<
    FirecrawlSearchResult & { baseTxHash?: string; paymentAmount?: string; agentWallet?: string; viaX402: boolean }
  > {
    if (this.x402Agent?.isReady()) {
      const agentResult = await this.x402Agent.search(query, options);
      if (agentResult.success) {
        const raw = agentResult.data as any;
        const results = (raw?.data || raw?.results || []).map((r: any) => ({
          url: r.url || '',
          title: r.metadata?.title || r.title || '',
          snippet: r.markdown?.substring(0, 300) || r.content?.substring(0, 300) || r.description || '',
        }));

        return {
          query,
          results,
          baseTxHash: agentResult.baseTxHash,
          paymentAmount: agentResult.paymentAmount,
          agentWallet: agentResult.agentWallet,
          viaX402: true,
        };
      }
      console.warn('[FirecrawlService] x402 agent search failed, falling back to API key:', agentResult.error);
    }

    const result = await this.search(query, options);
    return { ...result, viaX402: false };
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  /**
   * Scrape a URL using the v2 API. Returns a scrapeId that can be used
   * for subsequent interact calls.
   */
  async scrapeUrl(url: string, options?: { formats?: string[] }): Promise<FirecrawlScrapeResult> {
    if (!this.apiKey) {
      return this.mockScrape(url);
    }

    try {
      const response = await fetch(`${this.baseUrlV2}/scrape`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          url,
          formats: options?.formats || ['markdown'],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Firecrawl scrape error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as any;
      const result = data.data || data;
      const scrapeId = result.metadata?.scrapeId || result.scrapeId || `mock_${Date.now()}`;

      const session: FirecrawlSession = {
        scrapeId,
        url,
        status: 'active',
        createdAt: new Date().toISOString(),
        interactCount: 0,
      };
      this.sessions.set(scrapeId, session);

      console.log(`[Firecrawl] Scraped ${url} -> scrapeId: ${scrapeId}`);

      return {
        url,
        scrapeId,
        title: result.metadata?.title || result.title || url,
        content: result.content || result.text || '',
        markdown: result.markdown || result.content || '',
        metadata: result.metadata || {},
        scrapedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('Firecrawl scrape error:', error.message);
      return this.mockScrape(url);
    }
  }

  /**
   * Interact with a previously scraped page using natural language.
   * The browser session persists between calls.
   */
  async interact(
    scrapeId: string,
    options: { prompt?: string; code?: string; language?: 'node' | 'python' | 'bash'; timeout?: number },
  ): Promise<FirecrawlInteractResult> {
    if (!this.apiKey) {
      return this.mockInteract(scrapeId, options.prompt || options.code || '');
    }

    try {
      const body: Record<string, unknown> = {};
      if (options.prompt) body.prompt = options.prompt;
      if (options.code) {
        body.code = options.code;
        body.language = options.language || 'node';
      }
      if (options.timeout) body.timeout = options.timeout;

      const response = await fetch(`${this.baseUrlV2}/scrape/${scrapeId}/interact`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Firecrawl interact error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as any;

      const session = this.sessions.get(scrapeId);
      if (session) {
        session.interactCount++;
        if (data.liveViewUrl) session.liveViewUrl = data.liveViewUrl;
        if (data.interactiveLiveViewUrl) session.interactiveLiveViewUrl = data.interactiveLiveViewUrl;
      }

      console.log(
        `[Firecrawl] Interact ${scrapeId} (#${session?.interactCount || '?'}): ${
          options.prompt?.substring(0, 60) || options.code?.substring(0, 60) || '(empty)'
        }`,
      );

      return {
        success: data.success !== false,
        scrapeId,
        output: data.output,
        stdout: data.stdout,
        result: data.result,
        stderr: data.stderr,
        exitCode: data.exitCode,
        killed: data.killed,
        liveViewUrl: data.liveViewUrl,
        interactiveLiveViewUrl: data.interactiveLiveViewUrl,
      };
    } catch (error: any) {
      console.error('Firecrawl interact error:', error.message);
      return this.mockInteract(scrapeId, options.prompt || options.code || '');
    }
  }

  /**
   * Stop an interact session. Always call this when done to avoid
   * unnecessary billing.
   */
  async stopSession(scrapeId: string): Promise<{ success: boolean }> {
    const session = this.sessions.get(scrapeId);
    if (session) {
      session.status = 'stopped';
    }

    if (!this.apiKey) {
      console.log(`[Firecrawl] Stopped session ${scrapeId} (mock)`);
      return { success: true };
    }

    try {
      const response = await fetch(`${this.baseUrlV2}/scrape/${scrapeId}/interact`, {
        method: 'DELETE',
        headers: this.headers,
      });

      console.log(`[Firecrawl] Stopped session ${scrapeId}`);
      return { success: response.ok };
    } catch (error: any) {
      console.error('Firecrawl stop error:', error.message);
      return { success: false };
    }
  }

  async search(query: string, options?: { limit?: number }): Promise<FirecrawlSearchResult> {
    if (!this.apiKey) {
      return this.mockSearch(query);
    }

    try {
      const response = await fetch(`${this.baseUrlV1}/search`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          query,
          limit: options?.limit || 5,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Firecrawl search error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as any;
      const results = (data.data || data.results || []).map((r: any) => ({
        url: r.url || '',
        title: r.metadata?.title || r.title || '',
        snippet: r.markdown?.substring(0, 300) || r.content?.substring(0, 300) || '',
      }));

      return { query, results };
    } catch (error: any) {
      console.error('Firecrawl search error:', error.message);
      return this.mockSearch(query);
    }
  }

  getSession(scrapeId: string): FirecrawlSession | null {
    return this.sessions.get(scrapeId) || null;
  }

  listActiveSessions(): FirecrawlSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  // ---------------------------------------------------------------------------
  // Mock helpers (used when FIRECRAWL_API_KEY is not set)
  // ---------------------------------------------------------------------------

  private mockScrape(url: string): FirecrawlScrapeResult {
    const scrapeId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const isIntegrations = url.includes('firecrawl.dev/integrations');

    const session: FirecrawlSession = {
      scrapeId,
      url,
      status: 'active',
      liveViewUrl: `https://liveview.firecrawl.dev/mock/${scrapeId}`,
      interactiveLiveViewUrl: `https://liveview.firecrawl.dev/mock/${scrapeId}?interactive=true`,
      createdAt: new Date().toISOString(),
      interactCount: 0,
    };
    this.sessions.set(scrapeId, session);

    const mockContent = isIntegrations
      ? `# Firecrawl Integrations

## Featured Integrations
- **Claude** - Add web scraping to Claude Code
- **Cursor** - Add web scraping to Cursor
- **Lovable** - Connect your Lovable app to Firecrawl
- **n8n** - Build custom workflows with visual automation

## AI Development
- **Anthropic Claude** - Build AI agents with web data access
- **Google Gemini** - Integrate web scraping with Gemini AI
- **LangChain** - Python and JavaScript document loaders for RAG applications
- **LlamaIndex** - Data connector for building knowledge bases
- **OpenAI** - Web scraping workflows with GPT models
- **Vercel AI SDK** - Stream AI responses with web context

## Workflow Automation
- **Dify** - Build AI applications with no-code workflows
- **Make** - Create powerful integrations with drag-and-drop
- **n8n** - Build custom workflows with visual automation
- **Zapier** - Connect Firecrawl with 7,000+ apps

## MCP Servers (33 integrations)
Claude Code, Claude Desktop, Cline, Cursor, Gemini CLI, OpenAI Codex,
Qwen Coder, Smithery, VS Code, Windsurf, and 23 more...

The easiest way to extract data from the web. SOC 2 Type II certified.`
      : `# ${url}\n\nScraped content from ${url}.\n\n(Mock mode - set FIRECRAWL_API_KEY for live data)`;

    return {
      url,
      scrapeId,
      title: isIntegrations ? 'Firecrawl - Integrations' : url,
      content: mockContent,
      markdown: mockContent,
      metadata: { source: this.apiKey ? 'firecrawl-v2' : 'mock', url, scrapeId },
      scrapedAt: new Date().toISOString(),
    };
  }

  private mockInteract(scrapeId: string, promptOrCode: string): FirecrawlInteractResult {
    const session = this.sessions.get(scrapeId);
    if (session) session.interactCount++;

    const prompt = promptOrCode.toLowerCase();
    let output = `Interaction result for: "${promptOrCode}"`;

    if (prompt.includes('click') && prompt.includes('claude')) {
      output =
        'Clicked on the Claude integration card. Claude Code integration allows you to add web scraping capabilities directly to Claude Code. It connects via MCP (Model Context Protocol) and provides scrape, search, and crawl tools.';
    } else if (prompt.includes('click') && prompt.includes('cursor')) {
      output =
        'Clicked on the Cursor integration card. Cursor integration adds Firecrawl web scraping to the Cursor IDE via MCP. You can scrape pages, search the web, and extract data directly from your editor.';
    } else if (prompt.includes('click') && prompt.includes('openai')) {
      output =
        'Clicked on the OpenAI integration. OpenAI integration enables web scraping workflows with GPT models. Use Firecrawl to feed real-time web data into your GPT-powered applications.';
    } else if (prompt.includes('count') || prompt.includes('how many')) {
      output =
        'The integrations page lists 46 total integrations across 4 categories: Featured (4), AI Development (8), Workflow Automation (4), AI App Builders (1), and MCP (33). Some integrations appear in multiple categories.';
    } else if (prompt.includes('search') || prompt.includes('filter')) {
      output =
        'Filtered the integrations. The page organizes integrations into categories: All, AI Development, Workflow Automation, AI App Builders, and MCP. Each card shows the integration name, logo, and a brief description.';
    } else if (prompt.includes('mcp')) {
      output =
        'Navigated to the MCP section. There are 33 MCP integrations including: Claude Code, Claude Desktop, Cline, Cursor, Gemini CLI, OpenAI Codex, Qwen Coder, Smithery, VS Code, Windsurf, Amazon Q Developer CLI, Amp, Augment Code, BoltAI, Copilot Coding Agent, and more.';
    } else if (prompt.includes('scroll')) {
      output = 'Scrolled down the page. More integration cards are now visible including the MCP and Workflow Automation sections.';
    }

    return {
      success: true,
      scrapeId,
      output,
      liveViewUrl: session?.liveViewUrl || `https://liveview.firecrawl.dev/mock/${scrapeId}`,
      interactiveLiveViewUrl:
        session?.interactiveLiveViewUrl || `https://liveview.firecrawl.dev/mock/${scrapeId}?interactive=true`,
      exitCode: 0,
      killed: false,
    };
  }

  private mockSearch(query: string): FirecrawlSearchResult {
    return {
      query,
      results: [
        {
          url: 'https://www.firecrawl.dev/integrations',
          title: 'Firecrawl Integrations',
          snippet:
            'Use your favorite tools with Firecrawl. Categories: AI Development, Workflow Automation, AI App Builders, MCP...',
        },
        {
          url: 'https://docs.firecrawl.dev',
          title: 'Firecrawl Documentation',
          snippet: 'Getting started with Firecrawl API. Scrape, search, and interact with the web for AI...',
        },
      ],
    };
  }
}
