# Caderno de Vendas

App de controle de vendas mensais com comissão de 3%, organizado por data e com meta mensal.

## Como rodar

1. Abra esta pasta no VS Code.
2. Abra o terminal integrado (`Ctrl+\`` ou `Ctrl+J`) e rode:

```bash
npm install
npm run dev
```

3. Abra o endereço que aparecer no terminal (normalmente `http://localhost:5173`).

## Funcionalidades

- Botão **+ Nova venda** para registrar data, descrição (opcional) e valor.
- Tabela ordenada por data (clique no cabeçalho "Data" para inverter a ordem).
- Cálculo automático do **total bruto** e da **comissão de 3%** do mês.
- **Meta mensal** editável, com barra de progresso e selo quando a meta é batida.
- Navegação entre meses pelas setas ao lado do nome do mês.
- Os dados ficam salvos no `localStorage` do navegador — continuam lá mesmo se você fechar a aba.

## Estrutura

```
caderno-de-vendas/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    └── components/
        └── CadernoDeVendas.jsx
```

## Requisito

Node.js 18 ou superior instalado.
