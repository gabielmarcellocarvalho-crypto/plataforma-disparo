import type { Metadata } from "next";
import { LegalPage, Secao } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Política de Privacidade — AutomaX",
  description: "Como o AutomaX coleta, usa e protege dados no envio de mensagens e atendimento via WhatsApp e e-mail.",
};

export default function PoliticaPrivacidadePage() {
  return (
    <LegalPage titulo="Política de Privacidade" atualizadoEm="9 de agosto de 2026">
      <Secao titulo="1. Quem somos">
        <p>
          O AutomaX é uma plataforma de automação de atendimento e disparo de mensagens (WhatsApp e e-mail) operada por{" "}
          <strong className="text-text">CARVALHO ASSESSORIA DE MARKETING LTDA</strong>, CNPJ{" "}
          <strong className="text-text">48.885.778/0001-51</strong>. Fornecemos o AutomaX para empresas clientes
          ("Clientes") usarem no atendimento e comunicação com os próprios contatos e leads ("Usuários finais").
        </p>
        <p>
          Contato para assuntos de privacidade: <strong className="text-text">gabrielcarvalho@v4company.com</strong>.
        </p>
      </Secao>

      <Secao titulo="2. Papéis: controlador e operador de dados">
        <p>
          Em relação aos dados da <strong className="text-text">conta do Cliente</strong> (equipe, login, faturamento), o
          AutomaX atua como <strong className="text-text">controlador</strong>. Em relação aos{" "}
          <strong className="text-text">dados dos Usuários finais</strong> (contatos, leads e conversas que o Cliente
          importa ou recebe pela plataforma), o AutomaX atua como <strong className="text-text">operador</strong>: tratamos
          esses dados apenas para prestar o serviço contratado pelo Cliente, seguindo as instruções dele, nos termos da Lei
          Geral de Proteção de Dados (Lei 13.709/2018).
        </p>
      </Secao>

      <Secao titulo="3. Quais dados coletamos">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>Dados de cadastro do Cliente: nome, e-mail, telefone e credenciais de acesso da equipe.</li>
          <li>
            Dados dos Usuários finais fornecidos pelo Cliente ou recebidos via WhatsApp/e-mail: nome, telefone, e-mail e
            conteúdo das mensagens trocadas (texto, áudio e imagem) durante o atendimento.
          </li>
          <li>Metadados técnicos de envio e entrega de mensagens (status, horário, canal utilizado).</li>
          <li>Dados de uso da plataforma (login, ações realizadas) para segurança e suporte.</li>
        </ul>
      </Secao>

      <Secao titulo="4. Como usamos os dados">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>Enviar e receber mensagens em nome do Cliente pelos canais habilitados (WhatsApp Business Platform e e-mail).</li>
          <li>Gerar respostas automáticas de atendimento por inteligência artificial, quando o Cliente ativa esse recurso.</li>
          <li>Transcrever mensagens de áudio recebidas, quando aplicável.</li>
          <li>Exibir métricas, histórico de conversas e organização de funil (CRM) para o Cliente.</li>
          <li>Prevenir abuso, fraude e uso indevido da plataforma.</li>
        </ul>
      </Secao>

      <Secao titulo="5. Com quem compartilhamos dados">
        <p>Para operar o serviço, dados podem ser processados pelos seguintes fornecedores, apenas na medida necessária:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li><strong className="text-text">Meta / WhatsApp Business Platform</strong> — envio e recebimento de mensagens no WhatsApp.</li>
          <li><strong className="text-text">Anthropic</strong> — geração de respostas de atendimento por IA.</li>
          <li><strong className="text-text">OpenAI</strong> — transcrição de mensagens de áudio, quando esse recurso está ativo.</li>
          <li><strong className="text-text">Supabase</strong> — banco de dados e autenticação.</li>
          <li><strong className="text-text">Resend</strong> — envio de e-mails, quando esse canal está ativo.</li>
          <li><strong className="text-text">Vercel</strong> — hospedagem da aplicação.</li>
        </ul>
        <p>Não vendemos dados pessoais a terceiros.</p>
      </Secao>

      <Secao titulo="6. Retenção">
        <p>
          Mantemos os dados enquanto durar o contrato entre o AutomaX e o Cliente, ou pelo prazo definido por obrigação
          legal. Ao encerrar o contrato, o Cliente pode solicitar a exclusão ou exportação dos dados de sua conta.
        </p>
      </Secao>

      <Secao titulo="7. Segurança">
        <p>
          Aplicamos controle de acesso por conta, criptografia em trânsito (HTTPS) e isolamento dos dados entre Clientes
          (cada Cliente só acessa os próprios dados). Nenhum sistema é 100% livre de risco; se identificarmos um incidente
          de segurança relevante, notificaremos os Clientes afetados conforme exigido pela LGPD.
        </p>
      </Secao>

      <Secao titulo="8. Cookies">
        <p>
          Usamos cookies estritamente necessários para manter a sessão de login do Cliente na plataforma. Não usamos
          cookies de publicidade ou rastreamento de terceiros.
        </p>
      </Secao>

      <Secao titulo="9. Direitos do titular dos dados">
        <p>
          Nos termos da LGPD, o titular pode solicitar confirmação de tratamento, acesso, correção, anonimização,
          portabilidade ou eliminação de seus dados, além de revogar consentimento. Usuários finais devem direcionar esse
          pedido primeiro à empresa (Cliente) com quem conversaram; o AutomaX também pode ser contatado diretamente pelo
          canal informado na seção 1. Veja também nossa{" "}
          <a href="/exclusao-de-dados" className="text-primary-strong font-semibold hover:underline">
            página de exclusão de dados
          </a>
          .
        </p>
      </Secao>

      <Secao titulo="10. Alterações desta política">
        <p>
          Podemos atualizar esta política periodicamente. Mudanças relevantes serão comunicadas aos Clientes pelos canais
          de contato cadastrados.
        </p>
      </Secao>
    </LegalPage>
  );
}
