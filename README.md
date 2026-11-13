# Caderno de Vendas

App de controle de vendas mensais com comissão de 3%, organizado por data e com meta mensal.
Os dados ficam num **banco Postgres na Vercel**, então aparecem em qualquer aparelho onde você
entrar com a senha.

## Funcionalidades

- Botão **+ Nova venda** para registrar data, categoria (opcional), descrição (opcional) e valor.
- **Vários itens na mesma venda**: o botão **+ Adicionar outro item** no formulário junta, por
  exemplo, um kimono novo + uma faixa + um item de No-GI numa venda só. Cada item tem categoria,
  descrição e valor próprios; a data e a gorjeta são da venda. Na lista a venda aparece como uma
  linha com o total, e cada item continua contando na sua categoria no resumo.
  No banco cada item é uma linha de `vendas`, e as linhas da mesma venda compartilham a coluna
  `grupo` (vazia nas vendas de um item só, como todas as anteriores a essa mudança).
- **Cliente da venda** (opcional): o botão **+ Adicionar cliente (nome e telefone)** no formulário
  abre os dois campos. Na lista, o nome aparece em destaque na venda e o telefone vira um link
  que abre o discador no celular. A busca também encontra por nome ou por telefone.
- **Entrada do cliente** (opcional): o botão **+ Adicionar entrada do cliente** registra o sinal
  já pago. O formulário e a lista mostram o total, a entrada e quanto **falta receber**. A entrada
  não muda o total bruto, a meta nem a comissão — eles continuam sobre o valor cheio da venda.
- **Forma de pagamento** (opcional): botões **Cartão** e **Pix** no formulário — dá para marcar
  um, o outro ou os dois juntos. Com os dois marcados dá para informar quanto foi em cada um
  (ex.: R$ 100 no cartão e R$ 200 no Pix); preenchendo um, o outro completa com o que falta do total.
  Aparece na lista abaixo do valor, e a busca acha por "pix" ou "cartão".
- **Categorias** guardadas no banco (tabela `categorias`), semeada no primeiro acesso com
  Kimonos novos/usados/importados/Gracie Barra, No-GI e Protetores bucais.
  No formulário da venda as categorias são botões: um toque escolhe, outro desmarca.
  Botão **+ Nova categoria** cria e já seleciona a categoria — ela
  aparece em qualquer aparelho e sobrevive mesmo sem nenhuma venda usando ela.
  Grafias equivalentes ("no-gi" e "No-GI") são tratadas como a mesma.
- Botão **Categorias** no cabeçalho abre o gerenciamento: criar, **renomear** e excluir.
  Renomear roda em transação e atualiza junto todas as vendas que usavam o nome antigo.
  Excluir só é permitido para categoria sem nenhuma venda — em uso, o app avisa quantas
  vendas dependem dela e sugere renomear.
- **Resumo por categoria** do mês em gráfico de rosca, com o total no miolo e legenda com
  percentual e valor. Passar o mouse troca o número do miolo pela fatia; clicar filtra a lista.
  Acima de 6 categorias, as menores somam em "Outras" — o detalhamento completo sai em
  "Ver as N categorias".
- **Setas de minimizar** no resumo por categoria e em "Vendas do mês"; fechados, mostram
  um resumo de uma linha.
- **Filtros** por dia, texto (descrição ou categoria, ignorando acento e maiúscula), categoria,
  faixa de valor e "só com gorjeta", com subtotal do recorte filtrado. O seletor de dia tem atalho
  **Hoje**; escolher um dia de outro mês leva a navegação junto, e trocar de mês limpa o dia.
- Botão **+ Adicionar gorjeta / comissão extra** dentro da venda: o valor informado entra
  **integral na comissão**, sem contar no total bruto nem na meta.
- Botão **✎ Editar** em cada linha para corrigir data, descrição, valor ou gorjeta de uma venda já lançada.
- Botão **×** para excluir.
- Tabela ordenada por data (clique no cabeçalho "Data" para inverter a ordem).
- Cálculo automático do **total bruto** e da **comissão de 3% + gorjetas** do mês.
- **Meta mensal** editável, com barra de progresso e selo quando a meta é batida.
- Navegação entre meses pelas setas ao lado do nome do mês.
- **Exportar JSON** (backup completo em arquivo) e **Importar JSON** (substitui os dados do banco).
- Acesso protegido por senha.

## Publicar na Vercel

### 1. Criar o banco

No painel da Vercel, dentro do projeto: **Storage → Create Database → Neon (Postgres)**.
Ao conectar o banco ao projeto, a Vercel cria sozinha a variável `DATABASE_URL`.
As tabelas (`vendas`, `metas` e `categorias`) são criadas automaticamente no primeiro acesso — não precisa
rodar nenhum SQL à mão.

### 2. Definir a senha ou usuários

Em **Settings → Environment Variables**, adicione uma destas opções:

| Nome | Valor | Ambientes |
| ---- | ----- | --------- |
| `APP_SENHA` | a senha que quiser | Production, Preview, Development |
| `APP_USUARIOS` | `usuario1=suaSenha,usuario2=outraSenha` | Production, Preview, Development |

Para o uso com vários logins, preencha `APP_USUARIOS` e o login passa a pedir usuário + senha.
O modo legado com `APP_SENHA` continua funcionando para manter compatibilidade.

Sem pelo menos uma dessas variáveis a API responde erro — é proposital, para o caderno nunca ficar aberto.
Para trocar a senha ou os usuários depois, basta editar a variável e fazer um novo deploy (todo mundo que
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
| `/api/login`       | POST          | Recebe `{ usuario?, senha }` e cria a sessão (90 dias) |
| `/api/logout`      | POST          | Encerra a sessão                               |
| `/api/dados`       | GET, PUT      | Lê tudo; PUT substitui tudo (usado no importar)|
| `/api/vendas`      | GET, POST     | Lista as linhas; POST cria uma venda com `{ date, bonus, itens: [...] }` |
| `/api/vendas/[id]` | PUT, DELETE   | Edita e exclui uma venda inteira (todos os itens) |
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
