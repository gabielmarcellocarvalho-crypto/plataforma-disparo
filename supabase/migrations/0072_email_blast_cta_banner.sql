-- Disparo único de e-mail estava cru: o gerador de HTML (src/lib/email.ts) já sabia renderizar
-- botão de CTA, mas o motor de envio passava `undefined` no lugar dele — CTA só existia no modo
-- sequência, e mesmo lá travado no WhatsApp da campanha. Aqui o blast ganha CTA próprio (rótulo +
-- link livre) e um banner de topo, que a logo de 32px do workspace não resolvia.
alter table campaigns add column cta_label text;
alter table campaigns add column cta_url text;
alter table campaigns add column banner_url text;

-- O clique do CTA de blast passa pelo mesmo /api/e/<token> da sequência (linha em email_clicks,
-- step 0), então taxa de clique e aquecimento de lead funcionam igual. Nada a criar aqui: a tabela
-- email_clicks já existe desde 0040 e o step é int sem constraint de valor mínimo.
