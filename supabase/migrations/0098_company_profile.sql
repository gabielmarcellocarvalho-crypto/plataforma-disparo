-- Ficha completa da empresa: CNPJ e endereço. "Segmento" continua em `industry` e "URL" em `website`;
-- informações adicionais seguem em `custom_fields` e observações em `company_notes`.
alter table companies
  add column if not exists cnpj text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text;
