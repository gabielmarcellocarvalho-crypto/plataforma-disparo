// Cliente da API do Resend — gerenciamento de domínio e envio de e-mail, sem sair da plataforma.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const BASE_URL = "https://api.resend.com";

async function request(method: string, path: string, body?: unknown) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada.");
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Resend API ${res.status}`);
  return json;
}

export type DnsRecord = { record: string; name: string; type: string; ttl: string; value: string; priority?: number; status?: string };

export type ResendDomain = {
  id: string;
  name: string;
  status: string; // pending | verified | failed
  records?: DnsRecord[];
};

export async function createDomain(domainName: string): Promise<ResendDomain> {
  return request("POST", "/domains", { name: domainName });
}

export async function getDomain(domainId: string): Promise<ResendDomain> {
  return request("GET", `/domains/${domainId}`);
}

export async function verifyDomain(domainId: string): Promise<{ object: string; id: string }> {
  return request("POST", `/domains/${domainId}/verify`);
}

export async function sendEmail(from: string, to: string, subject: string, text: string) {
  return request("POST", "/emails", { from, to, subject, text });
}
