import { credenciaisValidas, handler, metodoNaoPermitido, papelDoUsuario, setCookieSessao } from "./_lib.js";

export default handler(async (req, res) => {
  if (req.method !== "POST") return metodoNaoPermitido(res, ["POST"]);

  const usuario = String(req.body?.usuario || "").trim();
  const senha = req.body?.senha;
  if (!senha || !credenciaisValidas(usuario, senha)) {
    res.status(401).json({ erro: "senha_incorreta" });
    return;
  }

  const papel = usuario ? papelDoUsuario(usuario) : "admin";
  setCookieSessao(res, usuario || null, senha);
  res.status(200).json({ ok: true, usuario: usuario || null, papel });
});
