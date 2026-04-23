import { createHmac } from 'crypto';

export function signWebhookPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export async function sendWebhookCallback(
  callbackUrl: string,
  payload: Record<string, unknown>,
  webhookSecret: string,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify(payload);
  const signature = signWebhookPayload(body, webhookSecret);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-256': `sha256=${signature}`,
        'X-Webhook-Timestamp': timestamp,
        'User-Agent': 'AgenticCommerce-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return { success: resp.ok, statusCode: resp.status };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = `sha256=${signWebhookPayload(payload, secret)}`;
  if (expected.length !== signature.length) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}
