import { useState, useEffect, useMemo } from "react";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const COMISSAO_TAXA = 0.03;

function ymKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function fmtMoney(n) {
  return "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MESES[m - 1]} de ${y}`;
}
function shiftMonth(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ymKey(d);
}

export default function CadernoDeVendas() {
  const [vendas, setVendas] = useState([]);
  const [metas, setMetas] = useState({});
  const [currentMonth, setCurrentMonth] = useState(ymKey(new Date()));
  const [sortAsc, setSortAsc] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem("caderno_vendas");
      const m = localStorage.getItem("caderno_metas");
      if (v) setVendas(JSON.parse(v));
      if (m) setMetas(JSON.parse(m));
    } catch (e) {
      console.error("Erro ao carregar dados salvos", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("caderno_vendas", JSON.stringify(vendas));
  }, [vendas, loaded]);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("caderno_metas", JSON.stringify(metas));
  }, [metas, loaded]);

  const list = useMemo(() => {
    const filtered = vendas.filter((v) => v.date.slice(0, 7) === currentMonth);
    filtered.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
    if (!sortAsc) filtered.reverse();
    return filtered;
  }, [vendas, currentMonth, sortAsc]);

  const totalBruto = useMemo(() => list.reduce((s, v) => s + v.value, 0), [list]);
  const comissao = totalBruto * COMISSAO_TAXA;
  const meta = metas[currentMonth] || 0;
  const pct = meta > 0 ? Math.min(100, (totalBruto / meta) * 100) : 0;
  const hit = meta > 0 && totalBruto >= meta;

  function addVenda({ date, description, value }) {
    setVendas((prev) => [
      ...prev,
      { id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), date, description, value },
    ]);
    setCurrentMonth(date.slice(0, 7));
    setModalOpen(false);
  }

  function deleteVenda(id) {
    setVendas((prev) => prev.filter((v) => v.id !== id));
  }

  function updateMeta(value) {
    setMetas((prev) => ({ ...prev, [currentMonth]: value }));
  }

  if (!loaded) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center text-inkSoft font-sans text-sm">
        Carregando seu caderno de vendas…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div className="max-w-3xl mx-auto px-5 py-9 pb-20">
        <Masthead
          currentMonth={currentMonth}
          onPrev={() => setCurrentMonth(shiftMonth(currentMonth, -1))}
          onNext={() => setCurrentMonth(shiftMonth(currentMonth, 1))}
        />
        <Stats
          totalBruto={totalBruto}
          comissao={comissao}
          count={list.length}
          meta={meta}
          pct={pct}
          hit={hit}
          onMetaChange={updateMeta}
        />
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="font-serif font-semibold text-base m-0">Vendas do mês</h2>
          <button
            onClick={() => setModalOpen(true)}
            className="bg-ink text-paper text-sm font-semibold rounded-lg px-4 py-2 hover:bg-[#142A20] transition-colors"
          >
            + Nova venda
          </button>
        </div>
        <Ledger
          list={list}
          sortAsc={sortAsc}
          onToggleSort={() => setSortAsc((s) => !s)}
          onDelete={deleteVenda}
          onAddEmpty={() => setModalOpen(true)}
          monthLabel={monthLabel(currentMonth)}
        />
      </div>
      {modalOpen && (
        <AddVendaModal
          currentMonth={currentMonth}
          onCancel={() => setModalOpen(false)}
          onSave={addVenda}
        />
      )}
    </div>
  );
}

function Masthead({ currentMonth, onPrev, onNext }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b-2 border-ink pb-3.5 mb-5 flex-wrap">
      <div>
        <h1 className="font-serif font-semibold text-3xl tracking-tight m-0">Caderno de vendas</h1>
        <p className="text-xs text-inkSoft uppercase tracking-wide mt-1">
          Registro mensal &middot; comissão de {(COMISSAO_TAXA * 100).toFixed(0)}%
        </p>
      </div>
      <div className="flex items-center gap-2.5 font-mono">
        <button
          onClick={onPrev}
          aria-label="Mês anterior"
          className="w-8 h-8 rounded-md border border-cardBorder hover:bg-paperStripe hover:border-inkFaint flex items-center justify-center text-ink"
        >
          ‹
        </button>
        <span className="text-sm font-semibold min-w-[128px] text-center capitalize">
          {monthLabel(currentMonth)}
        </span>
        <button
          onClick={onNext}
          aria-label="Próximo mês"
          className="w-8 h-8 rounded-md border border-cardBorder hover:bg-paperStripe hover:border-inkFaint flex items-center justify-center text-ink"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function Stats({ totalBruto, comissao, count, meta, pct, hit, onMetaChange }) {
  const [metaDraft, setMetaDraft] = useState(meta || "");

  useEffect(() => {
    setMetaDraft(meta || "");
  }, [meta]);

  function commit() {
    const val = parseFloat(String(metaDraft).replace(",", "."));
    onMetaChange(isNaN(val) || val < 0 ? 0 : val);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
      <div className="bg-white border border-cardBorder rounded-[10px] p-4 shadow-sm">
        <p className="text-[11px] uppercase tracking-wide text-inkSoft mb-1.5">Total bruto</p>
        <p className="font-mono text-xl font-semibold">{fmtMoney(totalBruto)}</p>
        <p className="text-[11px] text-inkFaint mt-1">
          {count} venda{count === 1 ? "" : "s"} no mês
        </p>
      </div>

      <div className="bg-white border border-cardBorder rounded-[10px] p-4 shadow-sm">
        <p className="text-[11px] uppercase tracking-wide text-inkSoft mb-1.5">
          Comissão ({(COMISSAO_TAXA * 100).toFixed(0)}%)
        </p>
        <p className="font-mono text-xl font-semibold text-goldDeep">{fmtMoney(comissao)}</p>
        <p className="text-[11px] text-inkFaint mt-1">sobre o total bruto</p>
      </div>

      <div className="relative bg-white border border-cardBorder rounded-[10px] p-4 shadow-sm overflow-hidden">
        {hit && (
          <span className="absolute top-2.5 -right-6 rotate-[10deg] border-2 border-greenStamp text-greenStamp font-mono text-[10px] font-semibold uppercase tracking-wide px-6 py-0.5 rounded">
            Meta batida
          </span>
        )}
        <p className="text-[11px] uppercase tracking-wide text-inkSoft mb-1.5">Meta do mês</p>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="0,00"
          value={metaDraft}
          onChange={(e) => setMetaDraft(e.target.value)}
          onBlur={commit}
          className="font-mono text-xl font-semibold bg-transparent border-b border-dashed border-inkFaint focus:border-gold outline-none w-full pb-0.5"
        />
        <p className="text-[10.5px] text-inkFaint mt-1">Toque para definir a meta em R$</p>
        <div className="mt-2.5 h-1.5 bg-paperStripe rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${hit ? "bg-greenStamp" : "bg-gold"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[11px] text-inkFaint mt-1">
          {meta > 0 ? `${pct.toFixed(0)}% da meta alcançada` : "Nenhuma meta definida"}
        </p>
      </div>
    </div>
  );
}

function Ledger({ list, sortAsc, onToggleSort, onDelete, onAddEmpty, monthLabel }) {
  return (
    <div className="bg-white border border-cardBorder rounded-[10px] shadow-sm overflow-hidden">
      {list.length === 0 ? (
        <div className="text-center py-11 px-5">
          <p className="font-serif font-semibold text-base mb-1.5">Nenhuma venda registrada</p>
          <p className="text-sm text-inkSoft mb-4">Adicione a primeira venda de {monthLabel}.</p>
          <button
            onClick={onAddEmpty}
            className="bg-ink text-paper text-sm font-semibold rounded-lg px-4 py-2 hover:bg-[#142A20]"
          >
            + Nova venda
          </button>
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th
                onClick={onToggleSort}
                className="cursor-pointer select-none text-left text-[11px] uppercase tracking-wide text-inkSoft px-3.5 py-2.5 border-b border-cardBorder bg-paperStripe font-mono hover:text-ink"
              >
                Data {sortAsc ? "↑" : "↓"}
              </th>
              <th className="hidden sm:table-cell text-left text-[11px] uppercase tracking-wide text-inkSoft px-3.5 py-2.5 border-b border-cardBorder bg-paperStripe">
                Descrição
              </th>
              <th className="text-right text-[11px] uppercase tracking-wide text-inkSoft px-3.5 py-2.5 border-b border-cardBorder bg-paperStripe">
                Valor
              </th>
              <th className="text-right text-[11px] uppercase tracking-wide text-inkSoft px-3.5 py-2.5 border-b border-cardBorder bg-paperStripe">
                Comissão
              </th>
              <th className="border-b border-cardBorder bg-paperStripe"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((v, i) => (
              <tr key={v.id} className={i % 2 === 1 ? "bg-paperStripe" : ""}>
                <td className="font-mono whitespace-nowrap text-sm px-3.5 py-2.5 border-b border-paperLine">
                  {fmtDate(v.date)}
                </td>
                <td className="hidden sm:table-cell text-sm text-inkSoft px-3.5 py-2.5 border-b border-paperLine">
                  {v.description || "—"}
                </td>
                <td className="font-mono text-right text-sm px-3.5 py-2.5 border-b border-paperLine">
                  {fmtMoney(v.value)}
                </td>
                <td className="font-mono text-right text-sm text-goldDeep px-3.5 py-2.5 border-b border-paperLine">
                  {fmtMoney(v.value * COMISSAO_TAXA)}
                </td>
                <td className="text-right px-3.5 py-2.5 border-b border-paperLine">
                  <button
                    onClick={() => onDelete(v.id)}
                    aria-label="Excluir venda"
                    className="text-inkFaint hover:text-redStamp hover:bg-[#FBEAE7] rounded px-1.5 text-base"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AddVendaModal({ currentMonth, onCancel, onSave }) {
  const today = new Date();
  const defaultDate = ymKey(today) === currentMonth ? today.toISOString().slice(0, 10) : `${currentMonth}-01`;
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState("");
  const [valor, setValor] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const value = parseFloat(valor);
    if (!date || isNaN(value) || value <= 0) return;
    onSave({ date, description: description.trim(), value });
  }

  return (
    <div
      className="fixed inset-0 bg-black/35 flex items-center justify-center p-5 z-50"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-paper border border-cardBorder rounded-xl w-full max-w-sm p-6 shadow-xl">
        <h3 className="font-serif font-semibold text-lg mb-4">Nova venda</h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-3.5">
            <label className="block text-xs uppercase tracking-wide text-inkSoft mb-1.5">Data</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full font-mono text-sm px-2.5 py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div className="mb-3.5">
            <label className="block text-xs uppercase tracking-wide text-inkSoft mb-1.5">Descrição (opcional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Cliente ou produto"
              className="w-full font-mono text-sm px-2.5 py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div className="mb-3.5 relative">
            <label className="block text-xs uppercase tracking-wide text-inkSoft mb-1.5">Valor da venda</label>
            <span className="absolute left-2.5 top-[34px] font-mono text-sm text-inkSoft">R$</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="0,00"
              required
              className="w-full font-mono text-sm pl-9 pr-2.5 py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onCancel}
              className="text-sm font-semibold px-4 py-2 rounded-lg border border-cardBorder hover:bg-paperStripe"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-ink text-paper border border-ink hover:bg-[#142A20]"
            >
              Salvar venda
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
