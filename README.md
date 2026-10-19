# POC — Portal de pedidos com SAP Business One

Prova de conceito do pacote `../portal-pedidos-sap-b1` (spec v2.0), feita para o
**Grupo Farina** (indústria de pães, Atibaia/SP) vender a supermercados e food service.
React + TypeScript no front, Node.js + TypeScript (Express) no back, mesma origem, sem
banco próprio. Roda de ponta a ponta com um **SAP simulado** em memória. O adaptador da
Service Layer real já existe, mas **não foi exercitado em base real**.

## Rodar

```bash
npm install
npm run dev        # http://localhost:5190, SAP simulado
npm test           # 33 testes: envio, revisão, sessão, isolamento por cliente, histórico
npm run build      # bundle de produção em dist/ (82 KB gzip de JS + 1 fonte de 42 KB)
```

Na tela de entrada, escolha uma identidade de teste. O código MFA de teste é `123456`.

| Identidade | O que mostra |
|---|---|
| Ana Ribeiro | Rede de supermercados com preço de contrato e faixa por quantidade (pão de forma PA0001 a partir de 10 caixas) |
| Carlos Menezes | Colega da Ana: mesmo cliente, outro usuário, vê os mesmos protocolos |
| Juliana Prado | Supermercado com outra lista de preço e um rascunho aguardando aprovação |
| Marcos Lima | Vínculo desativado no SAP: 403 sem nenhum dado comercial |
| Renata Souza | Login válido sem vínculo com cliente |

O botão **SAP simulado**, no canto superior direito, abre os bastidores. Ali dá para ver
`@PRT_REQUEST`, Orders/Drafts e `@PRT_ACCESS`, provocar falhas (SAP fora, resposta
perdida, recusa, falha na UDT), aprovar um rascunho como faria o SAP e reajustar um preço
depois da revisão.

## Roteiro de demonstração (10 min)

1. Entre como Ana. A página inicial mostra 6 meses de pedidos no SAP (portal, vendedor e
   EDI), os indicadores e a faixa "Precisa da sua atenção" (protocolo sem confirmação,
   previsão vencida, parcialmente faturado). Clique num pedido parcial: o painel lateral
   mostra o trilho e o que falta chegar por item. Em **Itens e preços**, abra o pão de
   forma PA0001 e veja o preço pago em cada compra.
2. Em **Catálogo**, inclua 12 caixas de PA0001. O catálogo mostra R$ 112,80; na revisão
   o SAP aplica R$ 108,00, porque a faixa vale a partir de 10.
3. Revise e dê **duplo clique** em Enviar: o pedido é criado uma vez só.
4. Nos bastidores, ligue "Perder a resposta do pedido" e envie outro pedido. O protocolo
   fica como incerto e não oferece reenvio; "Consultar novamente" acha o pedido por
   `U_PRT_ID`.
5. Revise um carrinho, reajuste o preço do item nos bastidores e tente enviar: o portal
   pede uma nova revisão.
6. Entre como Juliana, aprove o rascunho 3310 nos bastidores e consulte o protocolo: ele
   vira pedido com DocNum novo.
7. Desative o vínculo do Carlos com a sessão dele aberta: a próxima operação é negada.

## O que a POC prova e o que não prova

**Prova** (com teste automatizado): T01–T08, T10–T30 e T34 da matriz, com o SAP simulado.
Isso cobre a sequência do step 05 (reserva exclusiva, uma tentativa de Orders, resultado
incerto, conciliação, duplicidade como incidente), a revisão assinada de 5 minutos, o
isolamento por cliente, CSRF/Origin, cookie HttpOnly, limites e schemas estritos.

**Não prova**:

- Comportamento real da Service Layer. `server/sap/serviceLayer.ts` traz marcações
  "Confirmar" para D06, D08, D09, D11 e D13: chave duplicada na UDT, `GetItemPrice`,
  `OrdersService_Preview`, `GetApprovalTemplates`, UoM e paginação.
- OIDC e MFA reais. `/auth/demo/*` substitui o provedor; na implantação entram
  `/auth/login` e `/auth/callback` com Authorization Code + PKCE.
- Revisão de segurança independente, carga (T35), acessibilidade com leitor de tela (T36)
  e restauração do SAP (T33).

## Mudança de escopo: página inicial (19/10/2026)

A spec v2.0 deixava "histórico completo de vendas" fora do escopo. Por pedido do Alex, a
POC inclui uma página inicial com os pedidos do cliente e indicadores:

- `GET /api/v1/orders`: pedidos e rascunhos abertos do cliente nos últimos 6 meses, de
  qualquer origem, lidos do SAP na hora;
- `GET /api/v1/summary`: indicadores calculados sobre a mesma leitura (falta chegar,
  próxima previsão, comprado no mês comparado ao mês anterior, ticket médio, compras por
  mês, origem) e o bloco "precisa da sua atenção" (envios incertos do portal, previsão
  vencida, aguardando aprovação, parcialmente faturados);
- `GET /api/v1/items/history`: por item e unidade, quantidade, compras, último preço,
  média ponderada, menor–maior e o preço pago em cada compra.

A situação segue o mockup Luminatti e é medida pelo **faturamento**: Aguardando aprovação
(rascunho), Aprovado (pedido sem nota), Parcialmente faturado e Faturado. Não existe
"entregue", porque rastreio fica fora do escopo. Na Service Layer, o faturado sai hoje de
`RemainingOpenQuantity`, que também cai com a entrega: precisa confirmar na base real se a
medida certa são as linhas de OINV com base no pedido.

Uma armadilha ficou tratada: em item com faixa por quantidade, o preço de hoje do catálogo
(1 unidade) não é comparado ao último preço pago (outra faixa).

Nada é guardado no portal, então a regra de "sem banco próprio" continua valendo. Mesmo
assim é escopo novo: precisa entrar no registro de mudanças com reestimativa (estimativa
inicial: +16 a 24 h, incluindo paginação de Orders na base real e homologação dos números
com o comercial).

## Usar a Service Layer de homologação

```bash
set SAP_MODE=service-layer
set SL_URL=https://sap-hml.interno:50000/b1s/v2
set SL_COMPANY=SBO_HML
set SL_USER=portal_runtime
set SL_PASSWORD=...
set SEGREDO_REVISAO=...
npm run dev
```

Antes disso: UDTs `@PRT_ACCESS` e `@PRT_REQUEST` e os UDFs do step 01 criados na base,
vínculos das identidades de teste cadastrados, e `NODE_EXTRA_CA_CERTS` apontando para a CA
interna se o certificado não for público. Nunca desligue a validação TLS.

## Estrutura

```
server/
  app.ts               rotas, sessão, CSRF, limites, erros
  dominio/             revisão assinada, envio/conciliação, histórico, decimal exato
  sap/tipos.ts         contrato com o SAP (SapGateway)
  sap/simulado.ts      SAP em memória + bastidores
  sap/serviceLayer.ts  adaptador real (não exercitado)
web/src/
  telas/               Início, PainelPedido, ItensPrecos, Catálogo, Carrinho, Revisão,
                       Protocolo, Entrar, Bastidores
  ui/                  kit da casa (cópia do NFeIntegration, marca SPS)
test/                  node:test
```

## Identidade visual e navegação

- **Paleta SPS no fundo, Farina na marca.** Fundo, menu e botões ficam no navy e azul SAP
  da paleta da casa. O marrom do site do Farina como fundo foi testado e descartado.
  Do cliente entram o amarelo `#FCB92E` como assinatura (espiga, mês atual, item ativo do
  menu), a cursiva do título da entrada (Lobster, parecida com a do site), a foto da capa
  do site sob um véu navy, os logos das quatro marcas e as fotos dos produtos.
- **Tudo da marca em dois arquivos:** `web/src/marca/farina.css` e `web/src/ui/Marca.tsx`.
  O logo é o SVG oficial do cabeçalho do site, copiado com autorização do Alex. As espigas
  ficam no amarelo original e o texto troca de cor por contexto (cinza no claro, branco no
  menu e no escuro). Com o menu recolhido e no favicon aparecem só as espigas.
- **Catálogo = portfólio do site** (grupofarina.com.br, lido em 19/10/2026): Reali Junior,
  Pita Bread, Cabocla Mineira e Tá Pronto, com filtro por marca. Embalagens, preços e
  códigos PA são da demonstração. As fotos vêm do CDN do site do cliente
  (`static.wixstatic.com`, liberado na CSP); nada foi baixado para o projeto. A ordem das
  três fotos de tortilha foi deduzida da página: confirmar com o cliente.
- **Tema claro, escuro e automático** no botão do canto superior direito, aplicado antes do
  React carregar (`public/tema.js`). O contraste foi medido no componente rodando.
- **Menu lateral** com "Acompanhar" e "Comprar". Recolhe com Ctrl+B e vira gaveta no
  celular.