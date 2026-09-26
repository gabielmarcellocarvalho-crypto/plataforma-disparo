// OAuth do Google pra conectar a agenda do closer. `fetch` direto nos endpoints REST — o pacote
// `googleapis` é pesado e aqui só usamos 4 chamadas.

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const SCOPES = ["openid", "email", CALENDAR_SCOPE];

export const CALLBACK_PATH = "/api/integrations/google/callback";

// Autorização revogada, senha trocada ou (no modo de teste do app) expirada depois de 7 dias. Quem
// pega esse erro marca a conexão como "reconectar" e tira o closer do rodízio.
export class CalendarAuthError extends Error {}

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados.");
  return { clientId, clientSecret };
}

// A URI de retorno sai da origem da própria requisição: a mesma build atende localhost:3100 e o
// domínio de produção, e as duas estão cadastradas no cliente OAuth.
export function redirectUri(origin: string): string {
  return `${origin}${CALLBACK_PATH}`;
}

export function buildAuthUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: credentials().clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + consent: garante o refresh token mesmo quando a pessoa já autorizou antes.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    if (data.error === "invalid_grant") throw new CalendarAuthError(data.error_description || "Autorização do Google revogada ou expirada.");
    throw new Error(`Google OAuth ${res.status}: ${data.error_description || data.error || "erro desconhecido"}`);
  }
  return data;
}

export type ExchangedTokens = { refreshToken: string; accessToken: string; email: string | null; grantedCalendar: boolean };

export async function exchangeCode(origin: string, code: string): Promise<ExchangedTokens> {
  const { clientId, clientSecret } = credentials();
  const data = await tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
  if (!data.refresh_token) throw new Error("O Google não devolveu o refresh token.");
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    email: emailFromIdToken(data.id_token),
    // Na tela de consentimento a pessoa pode desmarcar a permissão da agenda e autorizar só o login.
    grantedCalendar: (data.scope || "").split(" ").includes(CALENDAR_SCOPE),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const data = await tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  return data.access_token;
}

// Best-effort: se o Google já tiver invalidado o token, desconectar do nosso lado segue valendo.
export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
}

// O id_token veio direto do endpoint de token do Google por HTTPS, então dá pra ler o payload sem
// validar a assinatura — só usamos o e-mail pra exibir qual conta foi conectada.
function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return data.email || null;
  } catch {
    return null;
  }
}
