export class NaoAutenticado extends Error {
  constructor() {
    super("nao_autenticado");
  }
}

async function req(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) throw new NaoAutenticado();

  let dados = null;
  try {
    dados = await res.json();
  } catch {
    /* resposta sem corpo */
  }

  if (!res.ok) {
    throw new Error(dados?.erro || `Falha na requisição (${res.status})`);
  }
  return dados;
}

export const api = {
  login: (senha) => req("/api/login", { method: "POST", body: { senha } }),
  logout: () => req("/api/logout", { method: "POST" }),

  carregarTudo: () => req("/api/dados"),
  substituirTudo: (vendas, metas) =>
    req("/api/dados", { method: "PUT", body: { vendas, metas } }),

  criarVenda: (venda) => req("/api/vendas", { method: "POST", body: venda }),
  atualizarVenda: (id, venda) =>
    req(`/api/vendas/${encodeURIComponent(id)}`, { method: "PUT", body: venda }),
  excluirVenda: (id) =>
    req(`/api/vendas/${encodeURIComponent(id)}`, { method: "DELETE" }),

  salvarMeta: (mes, valor) => req("/api/metas", { method: "PUT", body: { mes, valor } }),

  criarCategoria: (nome) => req("/api/categorias", { method: "POST", body: { nome } }),
  renomearCategoria: (de, para) => req("/api/categorias", { method: "PUT", body: { de, para } }),
  excluirCategoria: (nome) =>
    req(`/api/categorias?nome=${encodeURIComponent(nome)}`, { method: "DELETE" }),
};
