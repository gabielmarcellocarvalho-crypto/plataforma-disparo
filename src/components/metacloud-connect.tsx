"use client";

import Script from "next/script";
import { useEffect, useRef, useState, useTransition } from "react";
import { connectMetaCloudInstance } from "@/app/actions/whatsapp";

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        opts: { config_id: string; response_type: string; override_default_response_type: boolean; extras: Record<string, unknown> }
      ) => void;
    };
  }
}

// Payload que o popup de Embedded Signup manda via postMessage pro navegador (formato documentado
// pela Meta) — é daqui que tiramos waba_id/phone_number_id, não do retorno do FB.login em si.
type EmbeddedSignupMessage = {
  type?: string;
  event?: "FINISH" | "CANCEL" | "ERROR";
  data?: { waba_id?: string; phone_number_id?: string };
};

// Conecta um número novo direto pela Meta (Tech Provider/Embedded Signup) — sem QR code e sem API key
// digitada à mão, diferente de Evolution/360dialog. O cliente loga na própria conta dele num popup da
// Meta, autoriza a AutomaX a gerenciar o WhatsApp Business dele, e a Meta devolve o waba_id/phone_number_id
// via postMessage. Precisa de NEXT_PUBLIC_META_APP_ID e NEXT_PUBLIC_META_CONFIG_ID configurados (ver
// Configurações > Embedded Signup no App Dashboard da Meta).
export function MetacloudConnect({ department, onConnected }: { department: string; onConnected?: () => void }) {
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // O code (callback do FB.login, só dispara quando o popup fecha) e o waba_id/phone_number_id
  // (postMessage FINISH, mandado pelo popup um pouco ANTES de fechar) chegam em ordem não garantida
  // — na prática o postMessage costuma chegar primeiro. Guarda os dois em refs (não state, pra não
  // depender de re-render) e só finaliza quando os dois já tiverem chegado, não importa a ordem.
  const codeRef = useRef<string | null>(null);
  const finishDataRef = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);
  const finalizedRef = useRef(false);

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;

  // Inicializa via onReady do <Script> em vez de window.fbAsyncInit de propósito — fbAsyncInit é o
  // padrão "clássico" do SDK, mas depende de definir esse global ANTES do script carregar; com
  // next/script (injeta o <script> de forma assíncrona, fora da ordem normal de render), dava pra
  // esse efeito rodar depois do script já ter carregado e chamado fbAsyncInit — aí ele nunca mais
  // dispara, sdkReady fica false pra sempre e o botão "Conectar" fica desabilitado (sem avisar por
  // quê, só parece "não faz nada" ao clicar). onReady do next/script dispara certo mesmo se o script
  // já tiver carregado antes (troca de página/remount), o que resolve os dois casos.
  function handleSdkLoad() {
    window.FB?.init({ appId: appId || "", xfbml: false, version: "v21.0" });
    setSdkReady(true);
  }

  // Chamado depois que QUALQUER uma das duas peças (code ou waba/phone) chega — só age de verdade
  // quando as duas já estiverem disponíveis. `finalizedRef` evita chamar 2x se por algum motivo o
  // postMessage disparar mais de uma vez (a Meta já fez isso em alguns navegadores).
  function tryFinalize() {
    if (finalizedRef.current) return;
    const code = codeRef.current;
    const finish = finishDataRef.current;
    if (!code || !finish) return;
    finalizedRef.current = true;
    startTransition(async () => {
      const result = await connectMetaCloudInstance(finish.wabaId, finish.phoneNumberId, code, department);
      if (result.error) {
        setError(result.error);
        finalizedRef.current = false; // permite tentar de novo sem precisar reabrir o popup
      } else {
        onConnected?.();
      }
    });
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") {
        // Log em vez de ignorar em silêncio — se a Meta mudar o domínio que usa pro popup, isso é o
        // único jeito de perceber (não tem erro nenhum em lugar nenhum, só "nada acontece").
        if (typeof event.data === "string" ? event.data.includes("WA_EMBEDDED_SIGNUP") : (event.data as { type?: string })?.type === "WA_EMBEDDED_SIGNUP") {
          console.warn("Embedded Signup: mensagem WA_EMBEDDED_SIGNUP recebida de origem não esperada:", event.origin);
        }
        return;
      }
      // A Meta às vezes manda event.data já como objeto (não serializado), dependendo da versão do
      // SDK — JSON.parse quebraria com TypeError nesse caso (parse só aceita string), e como isso
      // ficava dentro de um try/catch mudo, o postMessage inteiro era descartado sem deixar rastro.
      let payload: EmbeddedSignupMessage;
      if (typeof event.data === "string") {
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
      } else if (event.data && typeof event.data === "object") {
        payload = event.data as EmbeddedSignupMessage;
      } else {
        return;
      }
      if (payload.type !== "WA_EMBEDDED_SIGNUP") return;
      console.log("Embedded Signup: evento recebido —", payload.event, payload.data);

      if (payload.event === "FINISH" && payload.data?.waba_id && payload.data?.phone_number_id) {
        finishDataRef.current = { wabaId: payload.data.waba_id, phoneNumberId: payload.data.phone_number_id };
        tryFinalize();
      } else if (payload.event === "CANCEL") {
        setError("Conexão cancelada.");
      } else if (payload.event === "ERROR") {
        setError("A Meta retornou um erro durante a conexão — tenta de novo.");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [department, onConnected]);

  function handleClick() {
    setError(null);
    codeRef.current = null;
    finishDataRef.current = null;
    finalizedRef.current = false;
    if (!window.FB || !configId) {
      setError("Embedded Signup não está configurado (faltam NEXT_PUBLIC_META_APP_ID/NEXT_PUBLIC_META_CONFIG_ID).");
      return;
    }
    window.FB.login(
      (response) => {
        // Só dispara quando o popup fecha — pode chegar antes OU depois do postMessage FINISH
        // (handleMessage acima), por isso passa pelo mesmo tryFinalize em vez de agir sozinho aqui.
        if (response.authResponse?.code) {
          codeRef.current = response.authResponse.code;
          tryFinalize();
        } else if (!finalizedRef.current) {
          // Callback só dispara 1x (popup fechou) — sem code aqui não tem como completar depois,
          // mesmo que o FINISH (waba/phone) já tenha chegado.
          setError(
            finishDataRef.current
              ? "Recebemos a confirmação do número, mas não veio o código de autorização da Meta — tenta conectar de novo."
              : "Conexão não foi concluída — tenta de novo e espera a Meta fechar o popup sozinha."
          );
        }
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      }
    );
  }

  if (!appId || !configId) {
    return (
      <p className="text-xs text-warning-text bg-warning-soft border border-warning-text/20 rounded-md p-3">
        Embedded Signup ainda não configurado nessa instalação — falta NEXT_PUBLIC_META_APP_ID e/ou
        NEXT_PUBLIC_META_CONFIG_ID nas variáveis de ambiente.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* onReady (não onLoad) de propósito — dispara tanto no primeiro carregamento quanto em
          remounts com o script já carregado (troca de workspace, reabrir o formulário), diferente de
          onLoad que só dispara 1x na vida da página. */}
      <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" onReady={handleSdkLoad} />
      <button
        type="button"
        onClick={handleClick}
        disabled={!sdkReady || pending}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md w-fit cursor-pointer disabled:opacity-60"
      >
        {pending ? "Conectando…" : sdkReady ? "Conectar via Meta" : "Carregando…"}
      </button>
      {error && <p className="text-sm text-danger font-medium">{error}</p>}
    </div>
  );
}
