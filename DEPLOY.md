# Deploy do Fibratur

## Requisitos

- Node.js 20+
- Build: `npm install && npm run build`
- Start: `npm start`

## Variaveis de ambiente

Configure em producao:

```bash
PORT=10000
HOST=0.0.0.0
DATA_DIR=/var/data/fibratur
APP_USER=seu_usuario
APP_PASSWORD=sua_senha_forte
```

`DATA_DIR` precisa apontar para um disco persistente. Ali ficam:

- `dados.json`
- `documentos.json`
- `senhas.json`
- `uploads/`

Sem disco persistente, a plataforma pode perder alteracoes quando reiniciar ou redeployar.

## Arquivos sensiveis

Nao suba `senhas.json`, `documentos.json` nem `uploads/` para GitHub publico.
Para levar os dados atuais para producao, copie esses arquivos manualmente para o `DATA_DIR` do servidor.

## Opcao recomendada: VPS

1. Envie o projeto para o servidor.
2. Rode:

```bash
npm install
npm run build
```

3. Crie a pasta persistente:

```bash
mkdir -p /var/data/fibratur/uploads
```

4. Copie os dados locais para `/var/data/fibratur`.
5. Inicie:

```bash
PORT=10000 HOST=0.0.0.0 DATA_DIR=/var/data/fibratur APP_USER=admin APP_PASSWORD='troque-essa-senha' npm start
```

## Render/Railway

Use:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Persistent disk: monte em `/var/data/fibratur`
- Environment variables: `DATA_DIR`, `APP_USER`, `APP_PASSWORD`, `HOST=0.0.0.0`

