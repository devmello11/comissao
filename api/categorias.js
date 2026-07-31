import {
  chaveCategoria,
  exigirLogin,
  garantirSchema,
  getSql,
  handler,
  limpaNomeCategoria,
  metodoNaoPermitido,
} from "./_lib.js";

export default handler(async (req, res) => {
  if (!exigirLogin(req, res)) return;
  await garantirSchema();
  const sql = getSql();

  if (req.method === "GET") {
    const rows = await sql`SELECT nome FROM categorias ORDER BY nome ASC`;
    res.status(200).json(rows.map((r) => r.nome));
    return;
  }

  if (req.method === "POST") {
    const nome = limpaNomeCategoria(req.body?.nome);
    if (!nome) {
      res.status(400).json({ erro: "nome_vazio" });
      return;
    }
    const chave = chaveCategoria(nome);

    // Se já existe (mesmo escrita diferente), devolve a que está lá em vez de duplicar.
    const [existente] = await sql`SELECT nome FROM categorias WHERE chave = ${chave}`;
    if (existente) {
      res.status(200).json({ nome: existente.nome, jaExistia: true });
      return;
    }

    await sql`INSERT INTO categorias (chave, nome) VALUES (${chave}, ${nome})`;
    res.status(201).json({ nome, jaExistia: false });
    return;
  }

  // PUT: renomeia. As vendas que usam a categoria antiga são atualizadas junto,
  // senão ficariam presas ao nome velho e a renomeação seria só cosmética.
  if (req.method === "PUT") {
    const de = limpaNomeCategoria(req.body?.de);
    const para = limpaNomeCategoria(req.body?.para);
    if (!de || !para) {
      res.status(400).json({ erro: "nome_vazio" });
      return;
    }
    const chaveDe = chaveCategoria(de);
    const chavePara = chaveCategoria(para);

    const [atual] = await sql`SELECT nome FROM categorias WHERE chave = ${chaveDe}`;
    if (!atual) {
      res.status(404).json({ erro: "categoria_nao_encontrada" });
      return;
    }
    // Mudar só a grafia (No-gi → No-GI) mantém a chave; aí não há colisão a checar.
    if (chaveDe !== chavePara) {
      const [colide] = await sql`SELECT nome FROM categorias WHERE chave = ${chavePara}`;
      if (colide) {
        res.status(409).json({ erro: "categoria_ja_existe", nome: colide.nome });
        return;
      }
    }

    await sql.transaction([
      sql`UPDATE categorias SET chave = ${chavePara}, nome = ${para} WHERE chave = ${chaveDe}`,
      sql`UPDATE vendas SET category = ${para} WHERE lower(category) = lower(${atual.nome})`,
    ]);

    const [{ afetadas }] = await sql`
      SELECT count(*)::int AS afetadas FROM vendas WHERE category = ${para}
    `;
    res.status(200).json({ nome: para, afetadas });
    return;
  }

  if (req.method === "DELETE") {
    const nome = limpaNomeCategoria(req.query?.nome);
    if (!nome) {
      res.status(400).json({ erro: "nome_vazio" });
      return;
    }
    const [alvo] = await sql`SELECT nome FROM categorias WHERE chave = ${chaveCategoria(nome)}`;
    if (!alvo) {
      res.status(404).json({ erro: "categoria_nao_encontrada" });
      return;
    }
    // Apagar uma categoria em uso deixaria as vendas apontando para um nome que
    // sumiu da lista — mas que continuaria aparecendo por vir das próprias vendas.
    // Em vez desse meio-termo confuso, bloqueia e explica.
    const [{ usos }] = await sql`
      SELECT count(*)::int AS usos FROM vendas WHERE lower(category) = lower(${alvo.nome})
    `;
    if (usos > 0) {
      res.status(409).json({ erro: "categoria_em_uso", usos });
      return;
    }

    await sql`DELETE FROM categorias WHERE chave = ${chaveCategoria(nome)}`;
    res.status(200).json({ ok: true });
    return;
  }

  metodoNaoPermitido(res, ["GET", "POST", "PUT", "DELETE"]);
});
