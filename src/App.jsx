import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

const EXCHANGE_RATE = 36.5;

const emptyLoan = {
  cliente_id: "",
  name: "",
  moneda_origen__c: "NIO",
  monto_origen__c: "",
  tipo_cambio__c: EXCHANGE_RATE,
  interes_mensual__c: 20,
  plazo_meses__c: 1,
  fecha_desembolso__c: todayIso(),
  fecha_vencimiento__c: todayIsoPlus(30),
  frecuencia_pago__c: "SEMANAL",
  estado__c: "Activo"
};

const emptyPayment = {
  prestamo_id: "",
  fecha__c: todayIso(),
  forma_pago__c: "EFECTIVO",
  moneda__c: "NIO",
  monto_origen__c: "",
  tipo_cambio__c: EXCHANGE_RATE,
  notas__c: ""
};

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayIsoPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function money(amount, currency = "USD") {
  const n = Number(amount || 0);
  const hasDecimals = Math.abs(n % 1) > 0.00001;
  const value = n.toLocaleString("es-NI", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0
  });
  return currency === "NIO" ? `C$ ${value}` : `$ ${value}`;
}

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("es-NI", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function parseNum(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function loanTotal(principal, interest, months) {
  const p = parseNum(principal);
  const i = parseNum(interest || 0) / 100;
  const m = Math.max(1, parseInt(months || 1, 10));
  return Number((p * (1 + i * m)).toFixed(2));
}

function toUsd(amount, currency, rate) {
  const n = parseNum(amount);
  const tc = parseNum(rate) || EXCHANGE_RATE;
  return currency === "NIO" ? Number((n / tc).toFixed(2)) : Number(n.toFixed(2));
}

function convertAmount(amount, fromCurrency, toCurrency, rate) {
  const n = parseNum(amount);
  const tc = parseNum(rate) || EXCHANGE_RATE;
  if (fromCurrency === toCurrency) return Number(n.toFixed(2));
  if (fromCurrency === "NIO" && toCurrency === "USD") return Number((n / tc).toFixed(2));
  if (fromCurrency === "USD" && toCurrency === "NIO") return Number((n * tc).toFixed(2));
  return Number(n.toFixed(2));
}

function buildSchedule(loanId, start, end, frequency) {
  if (!loanId || !start || !end) return [];
  if (frequency === "AL_VENCIMIENTO") {
    return [{ prestamo_id: loanId, fecha_cobro__c: end, estado__c: "Pendiente" }];
  }
  const rows = [];
  const endDate = new Date(`${end}T00:00:00`);
  const d = new Date(`${start}T00:00:00`);
  const step = frequency === "DIARIO" ? 1 : 7;
  d.setDate(d.getDate() + step);
  let guard = 0;
  while (d <= endDate && guard < 4000) {
    rows.push({ prestamo_id: loanId, fecha_cobro__c: d.toISOString().slice(0, 10), estado__c: "Pendiente" });
    d.setDate(d.getDate() + step);
    guard += 1;
  }
  return rows;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("clientes");
  const [clients, setClients] = useState([]);
  const [loans, setLoans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [cuotas, setCuotas] = useState([]);
  const [clientQuery, setClientQuery] = useState("");
  const [loanQuery, setLoanQuery] = useState("");
  const [loanFilter, setLoanFilter] = useState("all");
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [expandedLoanId, setExpandedLoanId] = useState(null);
  const [sortField, setSortField] = useState("proximo_pago__c");
  const [sortDir, setSortDir] = useState("asc");
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [loanModal, setLoanModal] = useState(false);
  const [payModal, setPayModal] = useState(false);
  const [clientModal, setClientModal] = useState(false);
  const [clientName, setClientName] = useState("");
  const [loanForm, setLoanForm] = useState(emptyLoan);
  const [payForm, setPayForm] = useState(emptyPayment);
  const [botOpen, setBotOpen] = useState(false);
  const [botInput, setBotInput] = useState("");
  const [botMessages, setBotMessages] = useState([
    { role: "bot", text: "Hola. Preguntame por cartera, cordobas, dolares, atrasados, cobros de hoy, clientes o mayor deuda." }
  ]);

  useEffect(() => {
    refreshAll();
    const channel = supabase
      .channel("loan-dashboard-db")
      .on("postgres_changes", { event: "*", schema: "public", table: "clientes__c" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "prestamo__c" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "prestamo_movimiento__c" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "prestamo_cuota__c" }, refreshAll)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function refreshAll() {
    setLoading(true);
    const [clientRes, loanRes, payRes, cuotaRes] = await Promise.all([
      supabase.from("clientes__c").select("*").order("name"),
      supabase.from("prestamo__c").select("*, clientes__c(name)").order("proximo_pago__c", { nullsFirst: false }),
      supabase.from("prestamo_movimiento__c").select("*").order("fecha__c"),
      supabase.from("prestamo_cuota__c").select("*, prestamo__c(name, saldo_pendiente_usd__c, clientes__c(name))").order("fecha_cobro__c")
    ]);

    const err = clientRes.error || loanRes.error || payRes.error || cuotaRes.error;
    if (err) showToast(`Supabase: ${err.message}`, "error");

    setClients(clientRes.data || []);
    setLoans((loanRes.data || []).map(normalizeLoan));
    setPayments(payRes.data || []);
    setCuotas(cuotaRes.data || []);
    setLoading(false);
  }

  function normalizeLoan(row) {
    const clientName = row.clientes__c?.name || "Sin cliente";
    const currency = row.moneda_origen__c || "USD";
    const total = Number(row.total_a_pagar__c || loanTotal(row.monto_origen__c, row.interes_mensual__c, row.plazo_meses__c));
    const due = total > 0 && ((row.proximo_pago__c && row.proximo_pago__c < todayIso()) || (row.fecha_vencimiento__c && row.fecha_vencimiento__c < todayIso()));
    const today = total > 0 && row.proximo_pago__c === todayIso();
    return { ...row, clientName, currency, currentTotal: total, isDue: due, isToday: today };
  }

  const filteredClients = useMemo(() => {
    const q = clientQuery.toLowerCase().trim();
    return clients.filter(c => !q || c.name.toLowerCase().includes(q));
  }, [clients, clientQuery]);

  const visibleLoans = useMemo(() => {
    const q = loanQuery.toLowerCase().trim();
    let rows = loans.filter(l => l.estado__c !== "Pagado");
    if (loanFilter === "due") rows = rows.filter(l => l.isDue);
    if (loanFilter === "today") rows = rows.filter(l => l.isToday);
    if (q) rows = rows.filter(l => `${l.name || ""} ${l.clientName}`.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [loans, loanQuery, loanFilter, sortField, sortDir]);

  const selectedClient = clients.find(c => c.id === selectedClientId);
  const selectedClientLoans = loans.filter(l => l.cliente_id === selectedClientId && l.estado__c !== "Pagado");

  const portfolio = useMemo(() => {
    const active = loans.filter(l => l.estado__c !== "Pagado");
    const nio = active.filter(l => l.currency === "NIO").reduce((a, l) => a + Number(l.currentTotal || 0), 0);
    const usd = active.filter(l => l.currency === "USD").reduce((a, l) => a + Number(l.currentTotal || 0), 0);
    const overdue = active.filter(l => l.isDue).length;
    const dueToday = active.filter(l => l.isToday).length;
    return { active: active.length, nio, usd, overdue, dueToday };
  }, [loans]);

  function paymentsForLoan(loanId) {
    return payments.filter(p => p.prestamo_id === loanId && p.tipo__c === "PAGO");
  }

  function paymentProgress(loan) {
    const rows = paymentsForLoan(loan.id);
    const applied = rows.reduce((acc, p) => acc + convertAmount(p.monto_origen__c, p.moneda__c, loan.currency, p.tipo_cambio__c || loan.tipo_cambio__c), 0);
    const originalTotal = loanTotal(loan.monto_origen__c, loan.interes_mensual__c, loan.plazo_meses__c);
    const pct = originalTotal > 0 ? Math.min(100, Math.round((applied / originalTotal) * 100)) : 0;
    return { applied, originalTotal, pct };
  }

  function showToast(message, kind = "success") {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3200);
  }

  function changeSort(field) {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function openPayment(loanId = "") {
    const loan = loans.find(l => l.id === loanId);
    setPayForm({
      ...emptyPayment,
      prestamo_id: loanId,
      moneda__c: loan?.currency || "NIO",
      tipo_cambio__c: loan?.tipo_cambio__c || EXCHANGE_RATE
    });
    setPayModal(true);
  }

  async function createClient(e) {
    e.preventDefault();
    if (!clientName.trim()) return;
    const { error } = await supabase.from("clientes__c").insert({ name: clientName.trim() });
    if (error) return showToast(error.message, "error");
    setClientName("");
    setClientModal(false);
    showToast("Cliente creado.");
    refreshAll();
  }

  async function createLoan(e) {
    e.preventDefault();
    const client = clients.find(c => c.id === loanForm.cliente_id);
    const total = loanTotal(loanForm.monto_origen__c, loanForm.interes_mensual__c, loanForm.plazo_meses__c);
    const principalUsd = toUsd(loanForm.monto_origen__c, loanForm.moneda_origen__c, loanForm.tipo_cambio__c);
    const saldoUsd = toUsd(total, loanForm.moneda_origen__c, loanForm.tipo_cambio__c);
    const symbol = loanForm.moneda_origen__c === "NIO" ? "C$" : "$";
    const payload = {
      name: loanForm.name || `${client?.name || "Cliente"} ${symbol}${parseNum(loanForm.monto_origen__c)} ${loanForm.moneda_origen__c}`,
      cliente_id: loanForm.cliente_id || null,
      estado__c: loanForm.estado__c,
      moneda_origen__c: loanForm.moneda_origen__c,
      monto_origen__c: parseNum(loanForm.monto_origen__c),
      monto_usd__c: principalUsd,
      tipo_cambio__c: parseNum(loanForm.tipo_cambio__c),
      interes_mensual__c: parseNum(loanForm.interes_mensual__c),
      plazo_meses__c: parseInt(loanForm.plazo_meses__c || 1, 10),
      total_a_pagar__c: total,
      total_abonado_usd__c: 0,
      saldo_pendiente_usd__c: saldoUsd,
      fecha_desembolso__c: loanForm.fecha_desembolso__c,
      fecha_vencimiento__c: loanForm.fecha_vencimiento__c,
      frecuencia_pago__c: loanForm.frecuencia_pago__c,
      proximo_pago__c: null
    };

    const { data, error } = await supabase.from("prestamo__c").insert(payload).select().single();
    if (error) return showToast(error.message, "error");

    const schedule = buildSchedule(data.id, payload.fecha_desembolso__c, payload.fecha_vencimiento__c, payload.frecuencia_pago__c);
    if (schedule.length) {
      const { error: scheduleError } = await supabase.from("prestamo_cuota__c").insert(schedule);
      if (scheduleError) showToast(scheduleError.message, "error");
      await supabase.from("prestamo__c").update({ proximo_pago__c: schedule[0].fecha_cobro__c }).eq("id", data.id);
    }

    await supabase.from("prestamo_movimiento__c").insert({
      prestamo_id: data.id,
      tipo__c: "DESEMBOLSO",
      fecha__c: payload.fecha_desembolso__c,
      moneda__c: payload.moneda_origen__c,
      monto_origen__c: payload.monto_origen__c,
      tipo_cambio__c: payload.tipo_cambio__c,
      notas__c: "Desembolso inicial"
    });

    setLoanForm(emptyLoan);
    setLoanModal(false);
    showToast("Prestamo creado.");
    refreshAll();
  }

  async function createPayment(e) {
    e.preventDefault();
    const loan = loans.find(l => l.id === payForm.prestamo_id);
    if (!loan) return showToast("Selecciona un prestamo.", "error");
    const appliedInLoanCurrency = convertAmount(payForm.monto_origen__c, payForm.moneda__c, loan.currency, payForm.tipo_cambio__c || loan.tipo_cambio__c);
    const appliedUsd = toUsd(appliedInLoanCurrency, loan.currency, payForm.tipo_cambio__c || loan.tipo_cambio__c);
    const newTotal = Math.max(0, Number(loan.currentTotal || 0) - appliedInLoanCurrency);
    const newSaldoUsd = toUsd(newTotal, loan.currency, payForm.tipo_cambio__c || loan.tipo_cambio__c);
    const estado = newTotal === 0 ? "Pagado" : (loan.fecha_vencimiento__c && loan.fecha_vencimiento__c < todayIso() ? "Vencido" : "Activo");

    const { error } = await supabase.from("prestamo_movimiento__c").insert({
      prestamo_id: loan.id,
      tipo__c: "PAGO",
      fecha__c: payForm.fecha__c,
      forma_pago__c: payForm.forma_pago__c,
      moneda__c: payForm.moneda__c,
      monto_origen__c: parseNum(payForm.monto_origen__c),
      tipo_cambio__c: parseNum(payForm.tipo_cambio__c),
      notas__c: payForm.notas__c || null
    });
    if (error) return showToast(error.message, "error");

    await supabase.from("prestamo__c").update({
      total_a_pagar__c: Number(newTotal.toFixed(2)),
      saldo_pendiente_usd__c: newSaldoUsd,
      total_abonado_usd__c: Number((Number(loan.total_abonado_usd__c || 0) + appliedUsd).toFixed(2)),
      estado__c: estado
    }).eq("id", loan.id);

    const nextCuota = cuotas.find(c => c.prestamo_id === loan.id && ["Pendiente", "Atrasada"].includes(c.estado__c));
    if (nextCuota) {
      await supabase.from("prestamo_cuota__c").update({ estado__c: "Pagada", fecha_pago__c: payForm.fecha__c }).eq("id", nextCuota.id);
    }
    const remaining = cuotas.filter(c => c.prestamo_id === loan.id && c.id !== nextCuota?.id && ["Pendiente", "Atrasada"].includes(c.estado__c));
    await supabase.from("prestamo__c").update({ proximo_pago__c: remaining[0]?.fecha_cobro__c || null, estado__c: estado }).eq("id", loan.id);

    setPayForm(emptyPayment);
    setPayModal(false);
    setExpandedLoanId(loan.id);
    showToast("Pago registrado.");
    refreshAll();
  }

  function askBot(text) {
    const question = (text || botInput).trim();
    if (!question) return;
    const answer = answerBot(question);
    setBotMessages([...botMessages, { role: "user", text: question }, { role: "bot", text: answer }]);
    setBotInput("");
  }

  function answerBot(raw) {
    const q = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const active = loans.filter(l => l.estado__c !== "Pagado");
    if (q.includes("cordoba") || q.includes("nio")) {
      const list = active.filter(l => l.currency === "NIO");
      if (!list.length) return "No hay prestamos en cordobas.";
      return `Total en cordobas: ${money(portfolio.nio, "NIO")}\n` + list.slice(0, 6).map(l => `- ${l.clientName}: ${money(l.currentTotal, "NIO")}`).join("\n");
    }
    if (q.includes("dolar") || q.includes("usd")) {
      const list = active.filter(l => l.currency === "USD");
      if (!list.length) return "No hay prestamos en dolares.";
      return `Total en dolares: ${money(portfolio.usd, "USD")}\n` + list.slice(0, 6).map(l => `- ${l.clientName}: ${money(l.currentTotal, "USD")}`).join("\n");
    }
    if (q.includes("deben") || q.includes("cartera") || q.includes("total")) {
      return `Cartera activa:\n- Prestamos: ${portfolio.active}\n- Cordobas: ${money(portfolio.nio, "NIO")}\n- Dolares: ${money(portfolio.usd, "USD")}\n- Atrasados: ${portfolio.overdue}`;
    }
    if (q.includes("atras") || q.includes("mora") || q.includes("vencid")) {
      const due = active.filter(l => l.isDue);
      if (!due.length) return "No hay prestamos atrasados.";
      return `Atrasados: ${due.length}\n` + due.slice(0, 6).map(l => `- ${l.clientName}: ${money(l.currentTotal, l.currency)}`).join("\n");
    }
    if (q.includes("hoy")) {
      const items = cuotas.filter(c => c.fecha_cobro__c === todayIso() && c.estado__c !== "Pagada");
      if (!items.length) return "No hay cobros para hoy.";
      return `Cobros de hoy: ${items.length}\n` + items.slice(0, 6).map(c => `- ${c.prestamo__c?.clientes__c?.name || "Cliente"}: ${c.prestamo__c?.name || "Prestamo"}`).join("\n");
    }
    if (q.includes("cliente")) return `Clientes registrados: ${clients.length}`;
    if (q.includes("mayor")) {
      const top = [...active].sort((a, b) => b.currentTotal - a.currentTotal).slice(0, 3);
      return "Mayores deudas:\n" + top.map((l, i) => `${i + 1}. ${l.clientName}: ${money(l.currentTotal, l.currency)}`).join("\n");
    }
    const nameHit = active.find(l => q.includes(l.clientName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
    if (nameHit) {
      const clientLoans = active.filter(l => l.cliente_id === nameHit.cliente_id);
      return `${nameHit.clientName} debe:\n` + clientLoans.map(l => `- ${money(l.currentTotal, l.currency)} en ${l.name}`).join("\n");
    }
    return "Puedes preguntarme: cuanto me deben, cuanto en cordobas, cuanto en dolares, atrasados, cobros hoy, mayor deuda o cuanto debe [cliente].";
  }

  const calendar = useMemo(() => {
    const base = new Date();
    base.setMonth(base.getMonth() + monthOffset);
    const y = base.getFullYear();
    const m = base.getMonth();
    const first = new Date(y, m, 1);
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first.getDay(); i += 1) cells.push(null);
    for (let d = 1; d <= days; d += 1) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ iso, day: d, count: cuotas.filter(c => c.fecha_cobro__c === iso && c.estado__c !== "Pagada").length });
    }
    return { label: base.toLocaleString("es", { month: "long", year: "numeric" }), cells };
  }, [cuotas, monthOffset]);

  const selectedDayItems = cuotas.filter(c => c.fecha_cobro__c === selectedDay && c.estado__c !== "Pagada");

  return (
    <div className="shell">
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
      <header className="topbar">
        <div>
          <div className="eyebrow">Pangea loans</div>
          <h1>Dashboard de Prestamos</h1>
          <p>Clientes, cartera, pagos y calendario conectados a Supabase.</p>
        </div>
        <div className="top-actions">
          <button onClick={refreshAll} className="icon-btn">Actualizar</button>
          <button onClick={() => setClientModal(true)} className="btn ghost">Cliente</button>
          <button onClick={() => setLoanModal(true)} className="btn primary">Nuevo prestamo</button>
          <button onClick={() => openPayment()} className="btn">Agregar pago</button>
        </div>
      </header>

      <section className="stats-grid">
        <Metric label="Prestamos activos" value={portfolio.active} />
        <Metric label="Cartera NIO" value={money(portfolio.nio, "NIO")} />
        <Metric label="Cartera USD" value={money(portfolio.usd, "USD")} />
        <Metric label="Atrasados" value={portfolio.overdue} danger={portfolio.overdue > 0} />
        <Metric label="Cobrar hoy" value={portfolio.dueToday} />
      </section>

      <nav className="tabs">
        {[["clientes", "Clientes"], ["prestamos", "Prestamos"], ["calendario", "Calendario"]].map(([key, label]) => (
          <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>{label}</button>
        ))}
      </nav>

      {loading && <div className="loading">Cargando datos...</div>}

      {activeTab === "clientes" && (
        <main className="two-col">
          <section className="panel">
            <div className="panel-head">
              <h2>Clientes</h2>
              <input placeholder="Buscar cliente" value={clientQuery} onChange={e => setClientQuery(e.target.value)} />
            </div>
            <div className="list">
              {filteredClients.map(c => {
                const activeLoans = loans.filter(l => l.cliente_id === c.id && l.estado__c !== "Pagado");
                const due = activeLoans.some(l => l.isDue);
                return (
                  <button key={c.id} className={`client-row ${selectedClientId === c.id ? "selected" : ""}`} onClick={() => setSelectedClientId(c.id)}>
                    <span><b>{c.name}</b><small>{activeLoans.length} prestamos activos</small></span>
                    <em className={due ? "pill danger" : "pill ok"}>{due ? "Atrasado" : "Activo"}</em>
                  </button>
                );
              })}
              {!filteredClients.length && <Empty text="No hay clientes." />}
            </div>
          </section>

          <section className="panel detail-panel">
            {selectedClient ? (
              <>
                <div className="detail-title">
                  <h2>{selectedClient.name}</h2>
                  <button className="btn" onClick={() => setLoanModal(true)}>Crear prestamo</button>
                </div>
                <div className="mini-grid">
                  <Metric label="Prestamos" value={selectedClientLoans.length} />
                  <Metric label="Saldo NIO" value={money(selectedClientLoans.filter(l => l.currency === "NIO").reduce((a, l) => a + l.currentTotal, 0), "NIO")} />
                  <Metric label="Saldo USD" value={money(selectedClientLoans.filter(l => l.currency === "USD").reduce((a, l) => a + l.currentTotal, 0), "USD")} />
                </div>
                <div className="loan-mini-list">
                  {selectedClientLoans.map(l => <LoanMini key={l.id} loan={l} progress={paymentProgress(l)} onPay={() => openPayment(l.id)} />)}
                  {!selectedClientLoans.length && <Empty text="Este cliente no tiene prestamos activos." />}
                </div>
              </>
            ) : <Empty text="Selecciona un cliente para ver su detalle." />}
          </section>
        </main>
      )}

      {activeTab === "prestamos" && (
        <main className="panel">
          <div className="panel-head loan-tools">
            <h2>Prestamos activos</h2>
            <input placeholder="Buscar por cliente o prestamo" value={loanQuery} onChange={e => setLoanQuery(e.target.value)} />
            <div className="chip-row">
              <button className={loanFilter === "all" ? "chip on" : "chip"} onClick={() => setLoanFilter("all")}>Todos</button>
              <button className={loanFilter === "due" ? "chip on" : "chip"} onClick={() => setLoanFilter("due")}>Atrasados</button>
              <button className={loanFilter === "today" ? "chip on" : "chip"} onClick={() => setLoanFilter("today")}>Cobrar hoy</button>
            </div>
          </div>
          <div className="sort-row">
            {[
              ["name", "Nombre"],
              ["clientName", "Cliente"],
              ["currentTotal", "Saldo"],
              ["proximo_pago__c", "Prox. pago"],
              ["fecha_vencimiento__c", "Vence"]
            ].map(([field, label]) => (
              <button key={field} onClick={() => changeSort(field)} className={sortField === field ? "chip on" : "chip"}>
                {label}{sortField === field ? (sortDir === "asc" ? " up" : " down") : ""}
              </button>
            ))}
          </div>
          <div className="loan-grid">
            {visibleLoans.map(l => (
              <LoanCard
                key={l.id}
                loan={l}
                payments={paymentsForLoan(l.id)}
                progress={paymentProgress(l)}
                expanded={expandedLoanId === l.id}
                onToggle={() => setExpandedLoanId(expandedLoanId === l.id ? null : l.id)}
                onPay={() => openPayment(l.id)}
              />
            ))}
            {!visibleLoans.length && <Empty text="No hay prestamos con ese filtro." />}
          </div>
        </main>
      )}

      {activeTab === "calendario" && (
        <main className="two-col">
          <section className="panel">
            <div className="calendar-head">
              <button className="icon-btn" onClick={() => setMonthOffset(monthOffset - 1)}>Anterior</button>
              <h2>{calendar.label}</h2>
              <button className="icon-btn" onClick={() => setMonthOffset(monthOffset + 1)}>Siguiente</button>
            </div>
            <div className="calendar-week"><span>Dom</span><span>Lun</span><span>Mar</span><span>Mie</span><span>Jue</span><span>Vie</span><span>Sab</span></div>
            <div className="calendar-grid">
              {calendar.cells.map((c, i) => c ? (
                <button key={c.iso} className={`day ${selectedDay === c.iso ? "selected" : ""} ${c.iso === todayIso() ? "today" : ""}`} onClick={() => setSelectedDay(c.iso)}>
                  <b>{c.day}</b>{c.count > 0 && <em>{c.count}</em>}
                </button>
              ) : <div key={i} />)}
            </div>
          </section>

          <section className="panel">
            <h2>Cobros del dia</h2>
            <p className="muted">{fmtDate(selectedDay)}</p>
            <div className="list">
              {selectedDayItems.map(c => (
                <div className="pay-item" key={c.id}>
                  <b>{c.prestamo__c?.clientes__c?.name || "Cliente"}</b>
                  <span>{c.prestamo__c?.name || "Prestamo"}</span>
                  <em className="pill warn">{c.estado__c}</em>
                </div>
              ))}
              {!selectedDayItems.length && <Empty text="No hay cobros para este dia." />}
            </div>
          </section>
        </main>
      )}

      <button className="bot-fab" onClick={() => setBotOpen(!botOpen)}>Bot</button>
      {botOpen && (
        <aside className="bot-panel">
          <div className="bot-head"><b>Asistente de cartera</b><button onClick={() => setBotOpen(false)}>x</button></div>
          <div className="bot-messages">{botMessages.map((m, i) => <div key={i} className={`bot-msg ${m.role}`}>{m.text}</div>)}</div>
          <div className="bot-chips">
            {["Cuanto me deben", "Cuanto en cordobas", "Cuanto en dolares", "Atrasados", "Cobros hoy", "Mayor deuda"].map(q => <button key={q} onClick={() => askBot(q)}>{q}</button>)}
          </div>
          <form className="bot-input" onSubmit={e => { e.preventDefault(); askBot(); }}>
            <input value={botInput} onChange={e => setBotInput(e.target.value)} placeholder="Escribe una pregunta" />
            <button>Enviar</button>
          </form>
        </aside>
      )}

      {clientModal && <Modal title="Nuevo cliente" onClose={() => setClientModal(false)}><form onSubmit={createClient} className="form"><label>Nombre<input value={clientName} onChange={e => setClientName(e.target.value)} required /></label><button className="btn primary">Guardar cliente</button></form></Modal>}
      {loanModal && <Modal title="Crear prestamo" onClose={() => setLoanModal(false)}><LoanForm form={loanForm} setForm={setLoanForm} clients={clients} onSubmit={createLoan} selectedClientId={selectedClientId} /></Modal>}
      {payModal && <Modal title="Agregar pago" onClose={() => setPayModal(false)}><PaymentForm form={payForm} setForm={setPayForm} loans={loans.filter(l => l.estado__c !== "Pagado")} onSubmit={createPayment} /></Modal>}
    </div>
  );
}

function Metric({ label, value, danger }) {
  return <div className="metric"><span>{label}</span><b className={danger ? "danger-text" : ""}>{value}</b></div>;
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

function LoanMini({ loan, progress, onPay }) {
  return (
    <div className="loan-mini">
      <div><b>{loan.name}</b><span>{money(loan.currentTotal, loan.currency)} pendiente</span></div>
      <div className="progress"><i style={{ width: `${progress.pct}%` }} /></div>
      <button className="btn small" onClick={onPay}>Pago</button>
    </div>
  );
}

function LoanCard({ loan, payments, progress, expanded, onToggle, onPay }) {
  return (
    <article className={`loan-card ${loan.isDue ? "due" : ""}`} onClick={onToggle}>
      <div className="loan-top"><div><b>{loan.name}</b><span>{loan.clientName}</span></div><strong>{money(loan.currentTotal, loan.currency)}</strong></div>
      <div className="loan-stats">
        <span>Total original <b>{money(progress.originalTotal, loan.currency)}</b></span>
        <span>Pagado <b>{money(progress.applied, loan.currency)}</b></span>
        <span>Prox. pago <b>{fmtDate(loan.proximo_pago__c)}</b></span>
        <span>Vence <b>{fmtDate(loan.fecha_vencimiento__c)}</b></span>
      </div>
      <div className="progress-wrap"><div className="progress"><i style={{ width: `${progress.pct}%` }} /></div><small>{progress.pct}% pagado</small></div>
      <div className="loan-actions"><button className="btn small" onClick={(e) => { e.stopPropagation(); onPay(); }}>Agregar pago</button></div>
      {expanded && (
        <div className="payments">
          <h3>Historial de pagos</h3>
          {payments.length ? payments.map(p => <div key={p.id} className="payment-row"><span>{fmtDate(p.fecha__c)}</span><b>{money(p.monto_origen__c, p.moneda__c)}</b><em>{p.forma_pago__c || "Pago"}</em></div>) : <Empty text="Sin pagos registrados." />}
        </div>
      )}
    </article>
  );
}

function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop"><section className="modal"><header><h2>{title}</h2><button onClick={onClose}>x</button></header>{children}</section></div>;
}

function LoanForm({ form, setForm, clients, onSubmit, selectedClientId }) {
  useEffect(() => { if (selectedClientId && !form.cliente_id) setForm(f => ({ ...f, cliente_id: selectedClientId })); }, [selectedClientId]);
  const update = e => setForm({ ...form, [e.target.name]: e.target.value });
  return (
    <form onSubmit={onSubmit} className="form grid-form">
      <label>Cliente<select name="cliente_id" value={form.cliente_id} onChange={update} required><option value="">Seleccionar</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Moneda<select name="moneda_origen__c" value={form.moneda_origen__c} onChange={update}><option>NIO</option><option>USD</option></select></label>
      <label>Monto<input name="monto_origen__c" value={form.monto_origen__c} onChange={update} type="number" step="0.01" required /></label>
      <label>Tipo cambio<input name="tipo_cambio__c" value={form.tipo_cambio__c} onChange={update} type="number" step="0.000001" /></label>
      <label>Interes mensual %<input name="interes_mensual__c" value={form.interes_mensual__c} onChange={update} type="number" step="0.01" /></label>
      <label>Plazo meses<input name="plazo_meses__c" value={form.plazo_meses__c} onChange={update} type="number" min="1" /></label>
      <label>Desembolso<input name="fecha_desembolso__c" value={form.fecha_desembolso__c} onChange={update} type="date" /></label>
      <label>Vencimiento<input name="fecha_vencimiento__c" value={form.fecha_vencimiento__c} onChange={update} type="date" /></label>
      <label>Frecuencia<select name="frecuencia_pago__c" value={form.frecuencia_pago__c} onChange={update}><option value="DIARIO">Diario</option><option value="SEMANAL">Semanal</option><option value="AL_VENCIMIENTO">Al vencimiento</option></select></label>
      <button className="btn primary wide">Guardar prestamo</button>
    </form>
  );
}

function PaymentForm({ form, setForm, loans, onSubmit }) {
  const update = e => setForm({ ...form, [e.target.name]: e.target.value });
  return (
    <form onSubmit={onSubmit} className="form grid-form">
      <label>Prestamo<select name="prestamo_id" value={form.prestamo_id} onChange={update} required><option value="">Seleccionar</option>{loans.map(l => <option key={l.id} value={l.id}>{l.clientName} - {l.name}</option>)}</select></label>
      <label>Fecha<input name="fecha__c" value={form.fecha__c} onChange={update} type="date" /></label>
      <label>Forma de pago<input name="forma_pago__c" value={form.forma_pago__c} onChange={update} /></label>
      <label>Moneda<select name="moneda__c" value={form.moneda__c} onChange={update}><option>NIO</option><option>USD</option></select></label>
      <label>Monto<input name="monto_origen__c" value={form.monto_origen__c} onChange={update} type="number" step="0.01" required /></label>
      <label>Tipo cambio<input name="tipo_cambio__c" value={form.tipo_cambio__c} onChange={update} type="number" step="0.000001" /></label>
      <label>Notas<textarea name="notas__c" value={form.notas__c} onChange={update} /></label>
      <button className="btn primary wide">Guardar pago</button>
    </form>
  );
}
