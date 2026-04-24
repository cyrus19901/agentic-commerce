import "dotenv/config";

type AnyObj = Record<string, any>;

type Args = {
  baseUrl: string;
  apiKey: string;
  userEmail: string;
  query: string;
  limit: number;
  register: boolean;
  settle: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    baseUrl: process.env.GORDON_BASE_URL || "http://localhost:3001",
    apiKey: process.env.GORDON_API_KEY || "",
    userEmail: process.env.TEST_USER_EMAIL || "cyrus19901@gmail.com",
    query: "api",
    limit: 12,
    register: false,
    settle: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base-url" && argv[i + 1]) out.baseUrl = argv[++i];
    else if (a === "--api-key" && argv[i + 1]) out.apiKey = argv[++i];
    else if (a === "--user-email" && argv[i + 1]) out.userEmail = argv[++i];
    else if (a === "--query" && argv[i + 1]) out.query = argv[++i];
    else if (a === "--limit" && argv[i + 1]) out.limit = Number(argv[++i]) || 12;
    else if (a === "--register") out.register = true;
    else if (a === "--settle") out.settle = true;
  }

  if (!out.apiKey) {
    throw new Error("Missing API key. Pass --api-key or set GORDON_API_KEY.");
  }

  return out;
}

function headers(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
  };
}

function buildSampleBody(svc: AnyObj): AnyObj | undefined {
  const endpoint = String(svc?.registerUrl || svc?.url || "").toLowerCase();
  const required = new Set<string>(
    (Array.isArray(svc?.requiredInputs) ? svc.requiredInputs : [])
      .map((x: unknown) => String(x || "").trim())
      .filter(Boolean),
  );

  if (endpoint.includes("/influencers-club/public/v1/discovery/creators/similar/")) {
    return {
      platform: "instagram",
      filter_key: "username",
      filter_value: "nike",
      paging: { skip: 0, limit: 1, page: 1 },
    };
  }

  if (required.size === 0) return undefined;

  const body: AnyObj = {};
  const put = (k: string, v: unknown) => {
    if (required.has(k)) body[k] = v;
  };
  put("url", "https://withgordon.ai");
  put("query", "withgordon");
  put("prompt", "hello");
  put("domain", "withgordon.ai");
  put("input", "https://withgordon.ai");
  put("platform", "instagram");
  put("handle", "nike");
  put("filter_key", "username");
  put("filter_value", "nike");
  put("paging", { skip: 0, limit: 1, page: 1 });
  put("creators", ["nike", "adidas"]);
  put("email", "demo@example.com");

  return Object.keys(body).length ? body : undefined;
}

async function callJson(
  baseUrl: string,
  apiKey: string,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: AnyObj,
): Promise<{ status: number; json: AnyObj }> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: headers(apiKey),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`\nOrthogonal readiness test`);
  console.log(`baseUrl=${args.baseUrl}`);
  console.log(`query=${args.query} limit=${args.limit}`);
  console.log(`register=${args.register} settle=${args.settle}\n`);

  const browse = await callJson(
    args.baseUrl,
    args.apiKey,
    `/marketplace/browse?source=orthogonal&q=${encodeURIComponent(args.query)}&limit=${args.limit}`,
  );
  if (browse.status !== 200) {
    throw new Error(`Browse failed: status=${browse.status} body=${JSON.stringify(browse.json).slice(0, 500)}`);
  }

  const services = Array.isArray(browse.json?.services) ? browse.json.services : [];
  if (!services.length) {
    console.log("No orthogonal services returned.");
    return;
  }

  const rows: AnyObj[] = [];
  for (const svc of services) {
    const url = String(svc?.registerUrl || svc?.url || "");
    const method = String(svc?.method || "GET").toUpperCase();
    const sampleBody = buildSampleBody(svc);

    const probeParams = new URLSearchParams();
    probeParams.set("url", url);
    if (method) probeParams.set("method", method);
    if (sampleBody) probeParams.set("sample_body", JSON.stringify(sampleBody));
    const probe = await callJson(args.baseUrl, args.apiKey, `/marketplace/probe?${probeParams.toString()}`);
    const compatible = Boolean(probe.json?.x402Compatible);
    const row: AnyObj = {
      name: svc?.name,
      url,
      method,
      compatible,
      probeStatus: probe.json?.status ?? probe.status,
      priceUsdc: probe.json?.priceUsdc ?? null,
      network: probe.json?.network ?? null,
      registerStatus: null,
      providerId: null,
      enabled: null,
      paymentStatus: null,
    };

    if (args.register && compatible) {
      const regBody: AnyObj = {
        url,
        name: svc?.name,
        category: svc?.category || "utility",
        source: "orthogonal",
        description: svc?.description || "",
        require_strict: false,
        method,
      };
      if (sampleBody) regBody.sample_body = sampleBody;

      const reg = await callJson(args.baseUrl, args.apiKey, "/marketplace/register", "POST", regBody);
      row.registerStatus = reg.status;
      row.providerId = reg.json?.provider?.id || null;
      row.enabled = reg.json?.provider?.enabled ?? null;
    }

    if (args.settle && row.providerId && row.enabled === true) {
      const pay = await callJson(args.baseUrl, args.apiKey, "/payments/pay", "POST", {
        provider_id: row.providerId,
        action: "request",
        params: {
          url: "https://withgordon.ai",
          query: "https://withgordon.ai",
          domain: "withgordon.ai",
          input: "https://withgordon.ai",
        },
        user_email: args.userEmail,
      });
      row.paymentStatus = pay.json?.status || pay.json?.error?.code || pay.status;
    }

    rows.push(row);
  }

  const demoReady = rows.filter((r) => r.compatible && (!args.register || r.enabled === true) && (!args.settle || r.paymentStatus === "completed"));
  const registerable = rows.filter((r) => r.compatible);
  const broken = rows.filter((r) => !r.compatible);

  console.log("\n=== Summary ===");
  console.log(`total=${rows.length} compatible=${registerable.length} demoReady=${demoReady.length} broken=${broken.length}`);
  console.log("\n=== Demo-ready ===");
  for (const r of demoReady) {
    console.log(`- ${r.name} | ${r.providerId || "n/a"} | price=${r.priceUsdc ?? "n/a"} | network=${r.network || "n/a"} | payment=${r.paymentStatus || "n/a"}`);
  }
  console.log("\n=== Not compatible / failed probe ===");
  for (const r of broken.slice(0, 20)) {
    console.log(`- ${r.name} | probeStatus=${r.probeStatus} | ${r.url}`);
  }

  console.log("\n=== Raw rows (JSON) ===");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});

