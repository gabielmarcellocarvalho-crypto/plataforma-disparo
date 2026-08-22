-- Cor de marca por workspace, usada no template de e-mail de campanha (nome do remetente, botão de
-- CTA, link de descadastro). NULL = mantém o roxo padrão da plataforma (comportamento atual).
alter table workspaces add column brand_color text;

-- Logo do cliente pra aparecer no cabeçalho do e-mail de campanha, em vez do nome em texto. Ao subir
-- uma logo (ver uploadWorkspaceLogo), brand_color é recalculado automaticamente a partir da cor
-- dominante da própria imagem — não precisa escolher a cor na mão.
alter table workspaces add column logo_url text;
