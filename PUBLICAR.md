# Publicar a POC na Vercel

A versão publicada é **estática**: o portal inteiro roda no navegador de quem abre o
link, com o SAP simulado e os mesmos testes de envio e conciliação da versão com
servidor. Não há servidor, banco nem dado real. Cada visitante tem a própria demo, e
recarregar a página reinicia o SAP simulado (o login fica guardado na aba).

`vercel.json` já define o build (`npm run build:vercel`), a pasta `dist`, `noindex` (o
link não entra no Google) e a CSP liberando só as fotos do CDN do site do Grupo Farina.

## Opção 1 — pela linha de comando (mais rápido)

No PowerShell, dentro de `C:\Projetos_SPS\Portal_Vendas\poc`:

```bash
npm install -g vercel
```

```bash
vercel login
```

```bash
vercel
```

Na primeira vez a Vercel pergunta o escopo (sua conta), o nome do projeto (sugestão:
`portal-grupo-farina`) e o diretório: aceite `./`. Não altere as configurações de build:
elas vêm do `vercel.json`. Isso gera um link de prévia. Para o link definitivo
`portal-grupo-farina.vercel.app`:

```bash
vercel --prod
```

Para atualizar depois de uma mudança, rode `vercel --prod` de novo na mesma pasta.

## Opção 2 — pelo painel, a partir do GitHub

1. Suba a pasta `poc` para um repositório (o `.gitignore` já exclui `node_modules` e `dist`).
2. Em vercel.com → **Add New → Project**, importe o repositório.
3. Se o repositório tiver mais coisas, defina **Root Directory** = a pasta `poc`.
4. Framework Preset: **Other**. O resto vem do `vercel.json`. Clique em **Deploy**.

## Antes de mandar o link

- O link é público e leva nome, logo e fotos do Grupo Farina. Combine com eles.
- Proteção por senha é recurso pago da Vercel. No plano gratuito, a tela de identidades
  de teste é a porta, e não há dado real nenhum.
- Roteiro de apresentação: README, seção "Roteiro de demonstração". MFA de teste: `123456`.

## Conferir localmente o que vai para a Vercel

```bash
npm run build:vercel
```

```bash
npm run preview:vercel
```

Abre em http://localhost:5191 exatamente o que será publicado.
