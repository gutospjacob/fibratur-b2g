# Checklist para deploy do Fibratur

## 1. O que vai no GitHub

O repositorio contem apenas o codigo da plataforma.

Nao versionar dados privados:

- `dados.json`
- `documentos.json`
- `senhas.json`
- `uploads/`
- arquivos `.bak`

Esses arquivos ficam fora do Git e devem ir para o disco persistente da hospedagem.

## 2. Stack

- Node.js 20+
- React + Vite
- Servidor Node nativo em `server.cjs`
- Persistencia local por arquivos JSON

## 3. Comandos

Build:

```bash
npm install && npm run build
```

Start:

```bash
npm start
```

## 4. Variaveis de ambiente

Obrigatorias/recomendadas em producao:

```bash
PORT=10000
HOST=0.0.0.0
DATA_DIR=/var/data/fibratur
APP_USER=admin
APP_PASSWORD=definir_senha_forte
```

O `DATA_DIR` precisa estar em disco persistente.

## 5. Render

Servico:

- Tipo: Web Service
- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm start`

Persistent Disk:

- Mount path: `/var/data/fibratur`
- Tamanho inicial: 1 GB ou maior

Environment:

- `HOST=0.0.0.0`
- `DATA_DIR=/var/data/fibratur`
- `APP_USER=...`
- `APP_PASSWORD=...`

## 6. Subir dados atuais

No computador local foi gerado um pacote separado:

```text
fibratur-dados-privados.zip
```

Ele contem os dados reais e deve ser copiado para o `DATA_DIR` do servidor, ficando assim:

```text
/var/data/fibratur/dados.json
/var/data/fibratur/documentos.json
/var/data/fibratur/senhas.json
/var/data/fibratur/uploads/
```

## 7. Pontos de atencao

- Se `DATA_DIR` nao for persistente, status, documentos e senhas podem sumir em restart/redeploy.
- O app usa Basic Auth quando `APP_USER` e `APP_PASSWORD` existem.
- O servidor precisa escutar `HOST=0.0.0.0` em producao.
- Nao subir o pacote de dados privados em repositorio publico.

