import { lookup } from "dns/promises";
import { isIP } from "net";

// fetch pra URL que QUEM CONFIGURA escolhe (passo "chamar webhook" dos workflows). Sem trava, um membro
// do workspace aponta pra um endereço interno (rede privada, metadados de nuvem, loopback) e o servidor
// faz a chamada por ele (SSRF). Aqui só passa endereço público, e cada redirecionamento é revalidado.
//
// Limite conhecido: o DNS é resolvido aqui e de novo dentro do fetch; um domínio que troca de IP entre
// as duas consultas (DNS rebinding) ainda poderia passar. Fecha a porta fácil, não a sofisticada.

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "esta rede"
  ["10.0.0.0", 8], // privada
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (inclui metadados de nuvem 169.254.169.254)
  ["172.16.0.0", 12], // privada
  ["192.0.0.0", 24],
  ["192.168.0.0", 16], // privada
  ["198.18.0.0", 15], // benchmark
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservado + broadcast
];

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4 embutido em IPv6
    if (mapped) return isBlockedIp(mapped[1]);
    if (/^f[cd]/.test(lower)) return true; // fc00::/7 (ULA)
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 (link-local)
    if (lower.startsWith("ff")) return true; // multicast
    return false;
  }
  return true; // não é IP válido: não deixa passar
}

export class UnsafeUrlError extends Error {}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL inválida.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Só http/https.");
  if (url.username || url.password) throw new UnsafeUrlError("URL com usuário/senha não é permitida.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new UnsafeUrlError("Endereço interno não é permitido.");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new UnsafeUrlError("Não foi possível resolver o endereço.");
  if (addresses.some((a) => isBlockedIp(a.address))) throw new UnsafeUrlError("Endereço interno não é permitido.");
  return url;
}

const MAX_REDIRECTS = 3;

export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttpUrl(current);
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError("Redirecionamentos demais.");
}
