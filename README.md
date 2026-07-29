# Caderno de Vendas

App de controle de vendas mensais com comissão de 3%, organizado por data e com meta mensal.
Os dados ficam num **banco Postgres na Vercel**, então aparecem em qualquer aparelho onde você
entrar com a senha.

## Funcionalidades

- Botão **+ Nova venda** para registrar data, descrição (opcional) e valor.
- Botão **✎ Editar** em cada linha para corrigir data, descrição ou valor de uma venda já lançada.
- Botão **×** para excluir.
- Tabela ordenada por data (clique no cabeçalho "Data" para inverter a ordem).
- Cálculo automático do **total bruto** e da **comissão de 3%** do mês.
- **Meta mensal** editável, com barra de progresso e selo quando a meta é batida.
- Navegação entre meses pelas setas ao lado do nome do mês.
- **Exportar JSON** (backup completo em arquivo) e **Importar JSON** (substitui os dados do banco).
- Acesso protegido por senha.

## Publicar na Vercel

### 1. Criar o banco

No painel da Vercel, dentro do projeto: **Storage → Create Database → Neon (Postgres)**.
Ao conectar o banco ao projeto, a Vercel cria sozinha a variável `DATABASE_URL`.
As tabelas (`vendas` e `metas`) são criadas automaticamente no primeiro acesso — não precisa
rodar nenhum SQL à mão.

### 2. Definir a senha

Em **Settings → Environment Variables**, adicione:

| Nome        | Valor              | Ambientes                        |
| ----------- | ------------------ | -------------------------------- |
| `APP_SENHA` | a senha que quiser | Production, Preview, Development |

Sem essa variável a API responde erro — é proposital, para o caderno nunca ficar aberto.
Para trocar a senha depois, basta editar a variável e fazer um novo deploy (todo mundo que
estiver logado precisará entrar de novo).

### 3. Deploy

`git push` na branch `main` — a Vercel detecta o Vite e as funções da pasta `api/` sozinha.

## Rodar na sua máquina

Como o app agora depende das funções serverless, use a CLI da Vercel (o `npm run dev` puro
sobe só a interface, e as chamadas de API falham):

```bash
npm install
npm i -g vercel        # só na primeira vez
vercel link            # conecta esta pasta ao projeto da Vercel
vercel env pull .env.local   # baixa DATABASE_URL e APP_SENHA
npm run dev:api        # sobe interface + API em http://localhost:3000
```

Se preferir não usar a CLI, copie o `.env.example` para `.env.local` e preencha na mão.

## API

Todas as rotas exigem o cookie de sessão criado pelo `POST /api/login`.

| Rota               | Métodos       | O que faz                                      |
| ------------------ | ------------- | ---------------------------------------------- |
| `/api/login`       | POST          | Recebe `{ senha }` e cria a sessão (90 dias)   |
| `/api/logout`      | POST          | Encerra a sessão                               |
| `/api/dados`       | GET, PUT      | Lê tudo; PUT substitui tudo (usado no importar)|
| `/api/vendas`      | GET, POST     | Lista e cria vendas                            |
| `/api/vendas/[id]` | PUT, DELETE   | Edita e exclui uma venda                       |
| `/api/metas`       | GET, PUT      | Lê metas; PUT grava a meta de um mês           |

## Estrutura

```
caderno-de-vendas/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── api/                     # funções serverless da Vercel
│   ├── _lib.js              # conexão, schema, senha e sessão
│   ├── login.js
│   ├── logout.js
│   ├── dados.js
│   ├── metas.js
│   └── vendas/
│       ├── index.js
│       └── [id].js
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── api.js               # cliente que fala com /api
    ├── index.css
    └── components/
        └── CadernoDeVendas.jsx
```

## Requisito

Node.js 18 ou superior instalado.

## Migração da versão antiga

A versão anterior guardava tudo no `localStorage` do navegador. Ao abrir a versão nova com o
banco vazio, se houver dados antigos no navegador o app oferece o botão **"Enviar para o banco"**
— um clique e as vendas antigas sobem para o Postgres.
