# Fibratur - Painel de Licitacoes

Plataforma local/web para triagem e gestao de licitacoes de turismo.

## Stack

- React 18 + Vite
- Node.js nativo para servidor/API (`server.cjs`)
- Persistencia em arquivos JSON
- Uploads/documentos em pasta local persistente

## Rodar localmente

```bash
npm install
npm run build
npm start
```

Por padrao abre em:

```text
http://localhost:5173
```

## Deploy

Veja o guia completo em [`DEPLOY.md`](DEPLOY.md).

Resumo para producao:

```bash
npm install
npm run build
npm start
```

Variaveis recomendadas:

```bash
PORT=10000
HOST=0.0.0.0
DATA_DIR=/var/data/fibratur
APP_USER=admin
APP_PASSWORD=troque-essa-senha
```

`DATA_DIR` deve estar em disco persistente.

## Dados privados

Nao versionar:

- `dados.json`
- `documentos.json`
- `senhas.json`
- `uploads/`
- backups `.bak`

Esses arquivos devem ser copiados manualmente para o `DATA_DIR` em producao.

