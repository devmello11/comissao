import {
  exigirAdmin,
  exigirLogin,
  garantirSchema,
  getSql,
  handler,
  linhasDaVenda,
  metodoNaoPermitido,
  normalizaVenda,
  validaVendaComItens,
} from "../_lib.js";

export default handler(async (req, res) => {
  if (!exigirLogin(req, res)) return;
  await garantirSchema();
  const sql = getSql();

  if (req.method === "GET") {
    const rows = await sql`
      SELECT id, date, description, value, bonus, category, grupo, ordem, cliente, telefone, entrada, pagamento, valor_cartao, valor_pix
      FROM vendas ORDER BY date ASC, created_at ASC, ordem ASC
    `;
    res.status(200).json(rows.map(normalizaVenda));
    return;
  }

  // POST: cria uma venda com um ou mais itens. Devolve as linhas gravadas (uma por item).
  if (req.method === "POST") {
    if (!exigirAdmin(req, res)) return;
    const { ok, itens, legado, erro } = validaVendaComItens(req.body);
    if (!ok) {
      res.status(400).json({ erro });
      return;
    }
    const linhas = linhasDaVenda(crypto.randomUUID(), itens);
    // Transação: ou entram todos os itens, ou nenhum — nunca uma venda pela metade.
    const resultados = await sql.transaction(
      linhas.map(
        (l) => sql`
          INSERT INTO vendas (id, date, description, value, bonus, category, grupo, ordem, cliente, telefone, entrada, pagamento, valor_cartao, valor_pix)
          VALUES (${l.id}, ${l.date}, ${l.description}, ${l.value}, ${l.bonus}, ${l.category}, ${l.grupo}, ${l.ordem}, ${l.cliente}, ${l.telefone}, ${l.entrada}, ${l.pagamento}, ${l.valorCartao}, ${l.valorPix})
          RETURNING id, date, description, value, bonus, category, grupo, ordem, cliente, telefone, entrada, pagamento, valor_cartao, valor_pix
        `
      )
    );
    const gravadas = resultados.map((r) => normalizaVenda(r[0]));
    res.status(201).json(legado ? gravadas[0] : gravadas);
    return;
  }

  metodoNaoPermitido(res, ["GET", "POST"]);
});
