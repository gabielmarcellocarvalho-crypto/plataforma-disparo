-- Identidade visual do e-mail deixa de ser imposta pelo workspace. Até aqui, TODA campanha saía com
-- a faixa de cabeçalho (logo, ou o nome do remetente quando não havia logo) e com a cor de marca —
-- e quando o workspace não tinha cor configurada, caía no roxo da própria plataforma, que não tem
-- nada a ver com o cliente. Agora é escolha de cada campanha.
alter table campaigns add column show_brand_header boolean not null default true;

-- Cor do botão de CTA e dos links. null = usa workspaces.brand_color (comportamento de antes).
alter table campaigns add column accent_color text;
