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

// O [id] da rota é a chave da venda: o grupo quando ela tem vários itens,
// ou o id da própria linha quando é uma venda de um item só (caso de todas as antigas).
export default handler(async (req, res) => {
  if (!exigirLogin(req, res)) return;
  await garantirSchema();
  const sql = getSql();
  const id = String(req.query.id || "");

  // PUT: troca os itens da venda pelos que vieram no corpo.
  if (req.method === "PUT") {
    if (!exigirAdmin(req, res)) return;
    const { ok, itens, legado, erro } = validaVendaComItens(req.body);
    if (!ok) {
      res.status(400).json({ erro });
      return;
    }
    const [existente] = await sql`
      SELECT created_at FROM vendas WHERE id = ${id} OR grupo = ${id}
      ORDER BY created_at ASC LIMIT 1
    `;
    if (!existente) {
      res.status(404).json({ erro: "venda_nao_encontrada" });
      return;
    }
    // Mantém a data de criação original para a venda não mudar de posição dentro do dia.
    const linhas = linhasDaVenda(id, itens);
    const resultados = await sql.transaction([
      sql`DELETE FROM vendas WHERE id = ${id} OR grupo = ${id}`,
      ...linhas.map(
        (l) => sql`
          INSERT INTO vendas (id, date, description, value, bonus, category, grupo, ordem, cliente, telefone, entrada, pagamento, valor_cartao, valor_pix, created_at)
          VALUES (${l.id}, ${l.date}, ${l.description}, ${l.value}, ${l.bonus}, ${l.category}, ${l.grupo}, ${l.ordem}, ${l.cliente}, ${l.telefone}, ${l.entrada}, ${l.pagamento}, ${l.valorCartao}, ${l.valorPix}, ${existente.created_at})
          RETURNING id, date, description, value, bonus, category, grupo, ordem, cliente, telefone, entrada, pagamento, valor_cartao, valor_pix
        `
      ),
    ]);
    const gravadas = resultados.slice(1).map((r) => normalizaVenda(r[0]));
    res.status(200).json(legado ? gravadas[0] : gravadas);
    return;
  }

  // DELETE: apaga a venda inteira, com todos os itens.
  if (req.method === "DELETE") {
    if (!exigirAdmin(req, res)) return;
    const rows = await sql`DELETE FROM vendas WHERE id = ${id} OR grupo = ${id} RETURNING id`;
    if (rows.length === 0) {
      res.status(404).json({ erro: "venda_nao_encontrada" });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  metodoNaoPermitido(res, ["PUT", "DELETE"]);
});
