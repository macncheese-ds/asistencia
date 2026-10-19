import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { ui } from "./ui";
import { APP_VERSION } from "./version";
import { fechaHoySaltillo } from "./zonaHoraria";

const API_BASE = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:3113/api`;

const ESTADO_LABELS = { pendiente: "Pendiente", autorizada: "Autorizada", denegada: "Denegada" };
const ESTADO_STYLES = {
  pendiente: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  autorizada: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  denegada: "bg-rose-500/15 text-rose-300 border-rose-500/40",
};
const CONFIG_LABELS = {
  dias_minimos_entre_escaneos: "Días mínimos entre escaneos",
  escaneos_aviso_guantes: "Escaneos para aviso de guantes",
  ventana_manana_inicio_min: "Ventana mañana: inicio",
  ventana_manana_fin_min: "Ventana mañana: fin",
  ventana_tarde_inicio_min: "Ventana tarde: inicio",
  ventana_tarde_fin_min: "Ventana tarde: fin",
  aviso_duracion_seg: "Tiempo de aviso en pantalla",
};
const CONFIG_CAMPOS_HORA = ["ventana_manana_inicio_min", "ventana_manana_fin_min", "ventana_tarde_inicio_min", "ventana_tarde_fin_min"];

// The backend stores windows as minutes since midnight; the form works with HH:MM
function minutosATexto(minutos) {
  const total = Number(minutos);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function textoATminutos(texto) {
  const [h, m] = String(texto || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function formatCampoValor(campo, valor) {
  if (valor === null || valor === undefined) return "-";
  if (CONFIG_CAMPOS_HORA.includes(campo)) return minutosATexto(valor);
  if (campo === "aviso_duracion_seg") return `${valor} s`;
  return valor;
}
const METRIC_TONES = {
  emerald: "border-emerald-500/50 text-emerald-300",
  amber: "border-amber-500/50 text-amber-300",
  red: "border-rose-500/50 text-rose-300",
};

const inputClass = ui.input;
const buttonClass = ui.button;
const primaryButtonClass = ui.success;
const dangerButtonClass = ui.danger;
const thClass = ui.th;
const tdClass = ui.td;
const labelClass = ui.label;

function errorText(err, fallback) {
  return err.response?.data?.error || fallback;
}

function todayIso() {
  return fechaHoySaltillo();
}

// Request ids are hex strings built with getRandomValues, which also works outside secure contexts (randomUUID does not)
function newRequestToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function formatDate(iso) {
  if (!iso) return "-";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function formatMinutes(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")} h`;
}

function formatWeekRange(mondayIso) {
  const [y, m, d] = mondayIso.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  return `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`;
}

function EstadoBadge({ estado }) {
  return (
    <span className={`inline-block border px-3 py-1 rounded-full text-sm font-semibold ${ESTADO_STYLES[estado] || "bg-slate-800 text-slate-300 border-slate-600"}`}>
      {ESTADO_LABELS[estado] || estado}
    </span>
  );
}

function Notice({ notice }) {
  if (!notice) return null;
  const style = notice.type === "error"
    ? "border-rose-500/60 bg-rose-500/10 text-rose-200"
    : "border-emerald-500/60 bg-emerald-500/10 text-emerald-200";
  return (
    <div role="alert" className={`mb-6 border-l-4 rounded-xl px-5 py-4 text-lg font-medium ${style}`}>
      {notice.text}
    </div>
  );
}

function Shell({ title, subtitle, actions, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/90 backdrop-blur-sm p-4 md:p-8">
      <div className={`max-w-5xl mx-auto ${ui.card} p-6 md:p-8`}>
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8 border-b border-white/5 pb-6">
          <div>
            <h2 className={ui.heading}>{title}</h2>
            {subtitle && <p className={`${ui.muted} mt-1`}>{subtitle}</p>}
          </div>
          <div className="flex flex-wrap gap-3">
            {actions}
            <button type="button" onClick={onClose} className={buttonClass}>Cerrar</button>
          </div>
        </div>
        {children}
        <p className="mt-8 pt-4 border-t border-white/5 text-center text-xs tracking-wider text-slate-500">
          Control Asistencia · Versión {APP_VERSION}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className={`bg-slate-900/60 border rounded-2xl p-5 shadow-lg shadow-black/20 ${METRIC_TONES[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}


function SemanasTable({ semanas }) {
  if (!semanas.length) {
    return <p className={`${ui.muted} text-lg`}>Sin solicitudes registradas.</p>;
  }
  return (
    <div className={ui.tableWrap}>
      <table className="w-full text-base">
        <thead className="border-b border-slate-800 bg-slate-900">
          <tr>
            <th className={thClass}>Semana (lunes a domingo)</th>
            <th className={thClass}>Pendiente</th>
            <th className={thClass}>Autorizada</th>
            <th className={thClass}>Denegada</th>
          </tr>
        </thead>
        <tbody>
          {semanas.map((s) => (
            <tr key={s.semana_inicio} className={ui.tableRow}>
              <td className={tdClass}>{formatWeekRange(s.semana_inicio)}</td>
              <td className={tdClass}>{formatMinutes(s.pendiente_min)}</td>
              <td className="p-3 font-semibold text-emerald-300">{formatMinutes(s.autorizada_min)}</td>
              <td className={tdClass}>{formatMinutes(s.denegada_min)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// Tool Room: registers hours already used by an employee. Reduces the available balance directly (no request).
function UsoHorasTab({ callApi, onNotice }) {
  const [busqueda, setBusqueda] = useState("");
  const [empleado, setEmpleado] = useState(null);
  const [totales, setTotales] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [form, setForm] = useState({ fecha: todayIso(), horas: "", minutos: "" });
  const pendingRef = useRef(null);
  const inFlightRef = useRef(false);

  const cargarTotales = async (num) => {
    try {
      setTotales(await callApi("get", `/txt/totales/${encodeURIComponent(num)}`));
    } catch (err) {
      onNotice({ type: "error", text: errorText(err, "No se pudieron cargar los totales") });
    }
  };

  const buscarEmpleado = async (e) => {
    e.preventDefault();
    const num = busqueda.trim();
    if (!num || buscando) return;
    setBuscando(true);
    onNotice(null);
    try {
      const data = await callApi("get", `/txt/empleados/${encodeURIComponent(num)}`);
      setEmpleado(data.empleado);
      setTotales(null);
      pendingRef.current = null;
      await cargarTotales(data.empleado.num_empleado);
    } catch (err) {
      setEmpleado(null);
      setTotales(null);
      onNotice({ type: "error", text: errorText(err, "Error al buscar el empleado") });
    } finally {
      setBuscando(false);
    }
  };

  const registrar = async (e) => {
    e.preventDefault();
    if (!empleado || inFlightRef.current) return;

    // Same retry protection as solicitudes: a repeated click or retry reuses the id and never consumes hours twice
    const key = [empleado.num_empleado, form.fecha, form.horas, form.minutos].join("|");
    if (!pendingRef.current || pendingRef.current.key !== key) {
      pendingRef.current = { key, token: newRequestToken() };
    }

    inFlightRef.current = true;
    setEnviando(true);
    try {
      const data = await callApi("post", "/txt/horas-utilizadas", {
        data: {
          num_empleado: empleado.num_empleado,
          fecha: form.fecha,
          horas: form.horas === "" ? "0" : form.horas,
          minutos: form.minutos === "" ? "0" : form.minutos,
          request_token: pendingRef.current.token,
        },
      });
      pendingRef.current = null;
      setForm({ fecha: form.fecha, horas: "", minutos: "" });
      onNotice({
        type: "success",
        text: data.duplicate
          ? "Este registro ya estaba guardado. No se volvió a descontar."
          : "Horas utilizadas registradas. El disponible se redujo.",
      });
      await cargarTotales(empleado.num_empleado);
    } catch (err) {
      onNotice({ type: "error", text: errorText(err, "No se pudieron registrar las horas utilizadas") });
    } finally {
      inFlightRef.current = false;
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-8">
      <form onSubmit={buscarEmpleado} className="flex flex-col sm:flex-row gap-3">
        <label htmlFor="uso-empleado" className="sr-only">Número de empleado</label>
        <input
          id="uso-empleado"
          className={`${inputClass} sm:flex-1`}
          placeholder="Número de empleado"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" disabled={buscando} className={buttonClass}>
          {buscando ? "Buscando..." : "Buscar empleado"}
        </button>
      </form>

      {empleado && (
        <div className="bg-slate-900 border-2 border-emerald-800 rounded-xl p-6 text-center">
          <p className="text-slate-400 uppercase tracking-widest text-sm mb-2">Empleado</p>
          <p className="text-4xl md:text-5xl font-black text-white break-words">{empleado.nombre}</p>
          <p className="text-2xl md:text-3xl font-bold text-emerald-300 mt-2">No. {empleado.num_empleado}</p>
          {empleado.area && <p className="text-slate-400 mt-2">{empleado.area}</p>}
        </div>
      )}

      {empleado && totales && (
        <div className="grid gap-4 md:grid-cols-2">
          <Metric label="Disponible" value={formatMinutes(totales.total_autorizado_min)} tone="emerald" />
          <Metric label="Utilizado (Tool Room)" value={formatMinutes(totales.utilizado_min)} tone="amber" />
        </div>
      )}

      {empleado && (
        <form onSubmit={registrar} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <h3 className={`${ui.sectionTitle} mb-6`}>Registrar horas utilizadas</h3>
          <div className="grid gap-5 md:grid-cols-3">
            <div>
              <label htmlFor="uso-fecha" className={labelClass}>Fecha de uso</label>
              <input
                id="uso-fecha"
                type="date"
                className={inputClass}
                value={form.fecha}
                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="uso-horas" className={labelClass}>Horas (0 a 24)</label>
              <input
                id="uso-horas"
                type="number"
                inputMode="numeric"
                min="0"
                max="24"
                step="1"
                className={inputClass}
                value={form.horas}
                onChange={(e) => setForm({ ...form, horas: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="uso-minutos" className={labelClass}>Minutos (0 a 59)</label>
              <input
                id="uso-minutos"
                type="number"
                inputMode="numeric"
                min="0"
                max="59"
                step="1"
                className={inputClass}
                value={form.minutos}
                onChange={(e) => setForm({ ...form, minutos: e.target.value })}
              />
            </div>
          </div>
          <p className="text-sm text-slate-400">
            Puedes usar una fecha pasada, de hoy o programada. Las horas se descuentan del disponible al registrarlas y no requieren autorización.
          </p>
          <button type="submit" disabled={enviando} className={`${primaryButtonClass} w-full md:w-auto`}>
            {enviando ? "Guardando..." : "Registrar horas utilizadas"}
          </button>
        </form>
      )}
    </div>
  );
}

function RegistroTab({ callApi, onNotice }) {
  const [busqueda, setBusqueda] = useState("");
  const [empleado, setEmpleado] = useState(null);
  const [totales, setTotales] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [form, setForm] = useState({ fecha: todayIso(), horas: "", minutos: "" });
  const pendingRef = useRef(null);
  const inFlightRef = useRef(false);

  const cargarTotales = async (num) => {
    try {
      setTotales(await callApi("get", `/txt/totales/${encodeURIComponent(num)}`));
    } catch (err) {
      onNotice({ type: "error", text: errorText(err, "No se pudieron cargar los totales") });
    }
  };

  const buscarEmpleado = async (e) => {
    e.preventDefault();
    const num = busqueda.trim();
    if (!num || buscando) return;
    setBuscando(true);
    onNotice(null);
    try {
      const data = await callApi("get", `/txt/empleados/${encodeURIComponent(num)}`);
      setEmpleado(data.empleado);
      setTotales(null);
      pendingRef.current = null;
      await cargarTotales(data.empleado.num_empleado);
    } catch (err) {
      setEmpleado(null);
      setTotales(null);
      onNotice({ type: "error", text: errorText(err, "Error al buscar el empleado") });
    } finally {
      setBuscando(false);
    }
  };

  const registrar = async (e) => {
    e.preventDefault();
    if (!empleado || inFlightRef.current) return;

    // The same request keeps its id across retries and double clicks; changed values get a new id
    const key = [empleado.num_empleado, form.fecha, form.horas, form.minutos].join("|");
    if (!pendingRef.current || pendingRef.current.key !== key) {
      pendingRef.current = { key, token: newRequestToken() };
    }

    inFlightRef.current = true;
    setEnviando(true);
    try {
      const data = await callApi("post", "/txt/solicitudes", {
        data: {
          num_empleado: empleado.num_empleado,
          fecha: form.fecha,
          horas: form.horas === "" ? "0" : form.horas,
          minutos: form.minutos === "" ? "0" : form.minutos,
          request_token: pendingRef.current.token,
        },
      });
      pendingRef.current = null;
      setForm({ fecha: form.fecha, horas: "", minutos: "" });
      onNotice({
        type: "success",
        text: data.duplicate
          ? "Esta solicitud ya estaba registrada. Queda pendiente de autorización."
          : `Solicitud registrada (${formatMinutes(data.solicitud?.minutos)}). Queda pendiente de autorización.`,
      });
      await cargarTotales(empleado.num_empleado);
    } catch (err) {
      onNotice({ type: "error", text: errorText(err, "No se pudo registrar la solicitud") });
    } finally {
      inFlightRef.current = false;
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-8">
      <form onSubmit={buscarEmpleado} className="flex flex-col sm:flex-row gap-3">
        <label htmlFor="txt-empleado" className="sr-only">Número de empleado</label>
        <input
          id="txt-empleado"
          className={`${inputClass} sm:flex-1`}
          placeholder="Número de empleado"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" disabled={buscando} className={buttonClass}>
          {buscando ? "Buscando..." : "Buscar empleado"}
        </button>
      </form>

      {empleado && (
        <div className="bg-slate-900 border-2 border-emerald-800 rounded-xl p-6 text-center">
          <p className="text-slate-400 uppercase tracking-widest text-sm mb-2">Empleado</p>
          <p className="text-4xl md:text-5xl font-black text-white break-words">{empleado.nombre}</p>
          <p className="text-2xl md:text-3xl font-bold text-emerald-300 mt-2">No. {empleado.num_empleado}</p>
          {empleado.area && <p className="text-slate-400 mt-2">{empleado.area}</p>}
        </div>
      )}

      {empleado && (
        <form onSubmit={registrar} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <h3 className={`${ui.sectionTitle} mb-6`}>Registrar horas</h3>
          <div className="grid gap-5 md:grid-cols-3">
            <div>
              <label htmlFor="txt-fecha" className={labelClass}>Fecha</label>
              <input
                id="txt-fecha"
                type="date"
                className={inputClass}
                value={form.fecha}
                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="txt-horas" className={labelClass}>Horas (0 a 24)</label>
              <input
                id="txt-horas"
                type="number"
                inputMode="numeric"
                min="0"
                max="24"
                step="1"
                className={inputClass}
                value={form.horas}
                onChange={(e) => setForm({ ...form, horas: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="txt-minutos" className={labelClass}>Minutos (0 a 59)</label>
              <input
                id="txt-minutos"
                type="number"
                inputMode="numeric"
                min="0"
                max="59"
                step="1"
                className={inputClass}
                value={form.minutos}
                onChange={(e) => setForm({ ...form, minutos: e.target.value })}
              />
            </div>
          </div>
          <p className="text-sm text-slate-400">
            Las horas quedan pendientes hasta que el ingeniero las autorice. No se suman al total autorizado.
          </p>
          <button type="submit" disabled={enviando} className={`${primaryButtonClass} w-full md:w-auto`}>
            {enviando ? "Enviando..." : "Enviar solicitud"}
          </button>
        </form>
      )}

      {empleado && totales && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Metric label="Disponible" value={formatMinutes(totales.total_autorizado_min)} tone="emerald" />
            <Metric label="Pendiente" value={formatMinutes(totales.pendiente_min)} tone="amber" />
            <Metric label="Denegado" value={formatMinutes(totales.denegada_min)} tone="red" />
          </div>
          <p className="text-sm text-slate-400">
            El disponible incluye el saldo de registros anteriores al nuevo sistema ({formatMinutes(totales.historico.horas_min)} generadas menos {formatMinutes(totales.historico.usadas_min)} usadas = {formatMinutes(totales.historico.saldo_min)}), más las horas autorizadas y menos las horas utilizadas registradas por Tool Room ({formatMinutes(totales.utilizado_min)}).
          </p>
          <div>
            <h3 className={`${ui.sectionTitle} mb-4`}>Acumulado semanal</h3>
            <SemanasTable semanas={totales.semanas} />
          </div>
        </div>
      )}
    </div>
  );
}

function AutorizacionTab({ callApi, onNotice }) {
  const filtrosVacios = { num_empleado: "", fecha: "", semana: "", estado: "" };
  const [pendientes, setPendientes] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [filtros, setFiltros] = useState(filtrosVacios);
  const [cargando, setCargando] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const busyRef = useRef(false);

  const cargarTodo = async (filtrosActuales) => {
    setCargando(true);
    try {
      const pendientesData = await callApi("get", "/txt/solicitudes", { params: { estado: "pendiente" } });
      setPendientes(pendientesData.solicitudes);
      const params = Object.fromEntries(Object.entries(filtrosActuales).filter(([, v]) => v));
      const historialData = await callApi("get", "/txt/solicitudes", { params });
      setHistorial(historialData.solicitudes);
    } catch (err) {
      onNotice({ type: "error", text: errorText(err, "No se pudieron cargar las solicitudes") });
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarTodo(filtrosVacios);
  }, []);

  const aplicarFiltros = (e) => {
    e.preventDefault();
    cargarTodo(filtros);
  };

  const limpiarFiltros = () => {
    setFiltros(filtrosVacios);
    cargarTodo(filtrosVacios);
  };

  const resolver = async (solicitud, accion) => {
    if (busyRef.current) return;
    if (accion === "denegar") {
      const confirmado = window.confirm(
        `¿Denegar ${formatMinutes(solicitud.minutos)} de ${solicitud.empleado_nombre} (No. ${solicitud.empleado_num})?`
      );
      if (!confirmado) return;
    }
    busyRef.current = true;
    setBusyId(solicitud.id);
    try {
      const data = await callApi("post", `/txt/solicitudes/${solicitud.id}/resolver`, { data: { accion } });
      onNotice({ type: "success", text: `${data.message} ${solicitud.empleado_nombre} (No. ${solicitud.empleado_num}).` });
    } catch (err) {
      onNotice({ type: "error", text: errorText(err, "No se pudo resolver la solicitud") });
    } finally {
      busyRef.current = false;
      setBusyId(null);
      await cargarTodo(filtros);
    }
  };

  const acciones = (s) => (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => resolver(s, "autorizar")} disabled={busyId === s.id} className={primaryButtonClass}>
        Autorizar
      </button>
      <button type="button" onClick={() => resolver(s, "denegar")} disabled={busyId === s.id} className={dangerButtonClass}>
        Denegar
      </button>
    </div>
  );

  return (
    <div className="space-y-10">
      <section>
        <h3 className={`${ui.sectionTitle} mb-4`}>
          Solicitudes pendientes <span className="text-slate-400 text-lg">({pendientes.length})</span>
        </h3>
        {pendientes.length === 0 ? (
          <p className="text-slate-400 text-lg">No hay solicitudes pendientes.</p>
        ) : (
          <div className="overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl">
            <table className="w-full text-base">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className={thClass}>Empleado</th>
                  <th className={thClass}>Fecha</th>
                  <th className={thClass}>Horas</th>
                  <th className={thClass}>Capturó</th>
                  <th className={thClass}>Capturada</th>
                  <th className={thClass}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((s) => (
                  <tr key={s.id} className="border-b border-slate-800">
                    <td className={tdClass}>
                      <span className="font-semibold text-white">{s.empleado_nombre}</span>
                      <br />
                      <span className="text-slate-400">No. {s.empleado_num}</span>
                    </td>
                    <td className={tdClass}>{formatDate(s.fecha)}</td>
                    <td className="p-3 font-bold text-white text-lg">{formatMinutes(s.minutos)}</td>
                    <td className={tdClass}>{s.capturado_por_num}</td>
                    <td className={tdClass}>{formatDateTime(s.capturado_at)}</td>
                    <td className="p-3">{acciones(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h3 className={`${ui.sectionTitle} mb-6`}>Historial de solicitudes</h3>
        <form onSubmit={aplicarFiltros} className="grid gap-4 md:grid-cols-5 items-end bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div>
            <label htmlFor="flt-empleado" className="block text-sm mb-2 text-slate-400">Empleado</label>
            <input id="flt-empleado" className={inputClass} placeholder="No. empleado" value={filtros.num_empleado}
              onChange={(e) => setFiltros({ ...filtros, num_empleado: e.target.value })} />
          </div>
          <div>
            <label htmlFor="flt-fecha" className="block text-sm mb-2 text-slate-400">Fecha</label>
            <input id="flt-fecha" type="date" className={inputClass} value={filtros.fecha}
              onChange={(e) => setFiltros({ ...filtros, fecha: e.target.value })} />
          </div>
          <div>
            <label htmlFor="flt-semana" className="block text-sm mb-2 text-slate-400">Semana (cualquier día)</label>
            <input id="flt-semana" type="date" className={inputClass} value={filtros.semana}
              onChange={(e) => setFiltros({ ...filtros, semana: e.target.value })} />
          </div>
          <div>
            <label htmlFor="flt-estado" className="block text-sm mb-2 text-slate-400">Estado</label>
            <select id="flt-estado" className={inputClass} value={filtros.estado}
              onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="autorizada">Autorizada</option>
              <option value="denegada">Denegada</option>
            </select>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={cargando} className={`${buttonClass} flex-1`}>Filtrar</button>
            <button type="button" onClick={limpiarFiltros} disabled={cargando} className={buttonClass}>Limpiar</button>
          </div>
        </form>

        {historial.length === 0 ? (
          <p className="text-slate-400 text-lg">No hay solicitudes con esos filtros.</p>
        ) : (
          <div className="overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl">
            <table className="w-full text-base">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className={thClass}>Empleado</th>
                  <th className={thClass}>Fecha</th>
                  <th className={thClass}>Horas</th>
                  <th className={thClass}>Estado</th>
                  <th className={thClass}>Capturó</th>
                  <th className={thClass}>Capturada</th>
                  <th className={thClass}>Resolvió</th>
                  <th className={thClass}>Resuelta</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((s) => (
                  <tr key={s.id} className="border-b border-slate-800">
                    <td className={tdClass}>
                      <span className="font-semibold text-white">{s.empleado_nombre}</span>
                      <br />
                      <span className="text-slate-400">No. {s.empleado_num}</span>
                    </td>
                    <td className={tdClass}>{formatDate(s.fecha)}</td>
                    <td className="p-3 font-bold text-white">{formatMinutes(s.minutos)}</td>
                    <td className="p-3"><EstadoBadge estado={s.estado} /></td>
                    <td className={tdClass}>{s.capturado_por_num}</td>
                    <td className={tdClass}>{formatDateTime(s.capturado_at)}</td>
                    <td className={tdClass}>{s.resuelto_por_num || "-"}</td>
                    <td className={tdClass}>{formatDateTime(s.resuelto_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const TIPO_HISTORIAL_LABELS = {
  agregada: { label: "Horas agregadas", style: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
  utilizada: { label: "Horas utilizadas", style: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  guante: { label: "Aviso de guantes", style: "bg-rose-500/15 text-rose-300 border-rose-500/40" }
};

function TipoBadge({ tipo }) {
  const info = TIPO_HISTORIAL_LABELS[tipo];
  return (
    <span className={`inline-block border px-3 py-1 rounded-full text-sm font-semibold ${info?.style || "bg-slate-800 text-slate-300 border-slate-600"}`}>
      {info?.label || tipo}
    </span>
  );
}

function HistorialTab({ callApi, onNotice }) {
  const [tipo, setTipo] = useState("");
  const [numEmpleado, setNumEmpleado] = useState("");
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(false);

  const cargar = async (filtros) => {
    setCargando(true);
    try {
      const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
      const data = await callApi("get", "/txt/historial", { params });
      setRegistros(data.registros);
    } catch (err) {
      onNotice({ type: "error", text: errorText(err, "No se pudo cargar el historial") });
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargar({});
  }, []);

  const aplicarFiltros = (e) => {
    e.preventDefault();
    cargar({ tipo, num_empleado: numEmpleado.trim() });
  };

  const detalle = (r) => {
    if (r.tipo === "agregada") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-white">{formatMinutes(r.minutos)}</span>
          <EstadoBadge estado={r.estado} />
        </div>
      );
    }
    if (r.tipo === "utilizada") {
      return <span className="font-bold text-white">{formatMinutes(r.minutos)}</span>;
    }
    return <span className="text-amber-200">Cambiar guantes · {r.escaneos_umbral} escaneos</span>;
  };

  return (
    <div className="space-y-6">
      <form onSubmit={aplicarFiltros} className="grid gap-4 md:grid-cols-4 items-end bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div>
          <label htmlFor="hist-tipo" className="block text-sm mb-2 text-slate-400">Tipo</label>
          <select id="hist-tipo" className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="agregada">Horas agregadas</option>
            <option value="utilizada">Horas utilizadas</option>
            <option value="guante">Avisos de guantes</option>
          </select>
        </div>
        <div>
          <label htmlFor="hist-empleado" className="block text-sm mb-2 text-slate-400">Empleado</label>
          <input id="hist-empleado" className={inputClass} placeholder="No. empleado" value={numEmpleado}
            onChange={(e) => setNumEmpleado(e.target.value)} />
        </div>
        <button type="submit" disabled={cargando} className={primaryButtonClass}>
          {cargando ? "Cargando..." : "Filtrar"}
        </button>
      </form>

      {registros.length === 0 ? (
        <p className="text-slate-400 text-lg">No hay registros con esos filtros.</p>
      ) : (
        <div className="overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl">
          <table className="w-full text-base">
            <thead className="border-b border-slate-800">
              <tr>
                <th className={thClass}>Registrado</th>
                <th className={thClass}>Tipo</th>
                <th className={thClass}>Empleado</th>
                <th className={thClass}>Fecha</th>
                <th className={thClass}>Detalle</th>
                <th className={thClass}>Por</th>
              </tr>
            </thead>
            <tbody>
              {registros.map((r) => (
                <tr key={`${r.tipo}-${r.id}`} className="border-b border-slate-800">
                  <td className={tdClass}>{formatDateTime(r.registrado_at)}</td>
                  <td className={tdClass}><TipoBadge tipo={r.tipo} /></td>
                  <td className={tdClass}>
                    <span className="font-semibold text-white">{r.empleado_nombre || "-"}</span>
                    <br />
                    <span className="text-slate-400">No. {r.empleado_num}</span>
                  </td>
                  <td className={tdClass}>{formatDate(r.fecha)}</td>
                  <td className={tdClass}>{detalle(r)}</td>
                  <td className={tdClass}>{r.registrado_por_num || "Sistema"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfiguracionTab({ callApi, onNotice }) {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({
    dias_minimos_entre_escaneos: "",
    escaneos_aviso_guantes: "",
    ventana_manana_inicio: "",
    ventana_manana_fin: "",
    ventana_tarde_inicio: "",
    ventana_tarde_fin: "",
    aviso_duracion_seg: "",
  });
  const [historial, setHistorial] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const busyRef = useRef(false);

  const cargar = async () => {
    try {
      const [cfgData, histData] = await Promise.all([
        callApi("get", "/txt/config"),
        callApi("get", "/txt/config/historial"),
      ]);
      const cfg = cfgData.config;
      const camposNuevos = ["ventana_manana_inicio_min", "ventana_manana_fin_min", "ventana_tarde_inicio_min", "ventana_tarde_fin_min", "aviso_duracion_seg"];
      if (camposNuevos.some((c) => cfg[c] === undefined || cfg[c] === null)) {
        onNotice({ type: "error", text: "El servidor no devuelve las ventanas de registro ni el tiempo de aviso. Reinicia el backend (node index.js) y recarga la página." });
      }
      setConfig(cfg);
      setForm({
        dias_minimos_entre_escaneos: String(cfg.dias_minimos_entre_escaneos),
        escaneos_aviso_guantes: String(cfg.escaneos_aviso_guantes),
        ventana_manana_inicio: minutosATexto(cfg.ventana_manana_inicio_min),
        ventana_manana_fin: minutosATexto(cfg.ventana_manana_fin_min),
        ventana_tarde_inicio: minutosATexto(cfg.ventana_tarde_inicio_min),
        ventana_tarde_fin: minutosATexto(cfg.ventana_tarde_fin_min),
        aviso_duracion_seg: String(cfg.aviso_duracion_seg),
      });
      setHistorial(histData.historial);
    } catch (err) {
      onNotice({ type: "error", text: errorText(err, "No se pudo cargar la configuración") });
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const guardar = async (e) => {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setGuardando(true);
    try {
      const data = await callApi("put", "/txt/config", {
        data: {
          dias_minimos_entre_escaneos: form.dias_minimos_entre_escaneos,
          escaneos_aviso_guantes: form.escaneos_aviso_guantes,
          ventana_manana_inicio_min: textoATminutos(form.ventana_manana_inicio),
          ventana_manana_fin_min: textoATminutos(form.ventana_manana_fin),
          ventana_tarde_inicio_min: textoATminutos(form.ventana_tarde_inicio),
          ventana_tarde_fin_min: textoATminutos(form.ventana_tarde_fin),
          aviso_duracion_seg: form.aviso_duracion_seg,
        },
      });
      onNotice({ type: "success", text: data.message });
      await cargar();
    } catch (err) {
      onNotice({ type: "error", text: errorText(err, "No se pudo guardar la configuración") });
    } finally {
      busyRef.current = false;
      setGuardando(false);
    }
  };

  if (!config) {
    return <p className="text-slate-400 text-lg">Cargando configuración...</p>;
  }

  return (
    <div className="space-y-10">
      <section className="grid gap-4 md:grid-cols-2">
        <Metric label="Días mínimos entre escaneos (actual)" value={`${config.dias_minimos_entre_escaneos} día(s)`} tone="emerald" />
        <Metric label="Escaneos para aviso de guantes (actual)" value={String(config.escaneos_aviso_guantes)} tone="amber" />
        <Metric
          label="Ventana de registro mañana (actual)"
          value={`${minutosATexto(config.ventana_manana_inicio_min)} - ${minutosATexto(config.ventana_manana_fin_min)}`}
          tone="emerald"
        />
        <Metric
          label="Ventana de registro tarde (actual)"
          value={`${minutosATexto(config.ventana_tarde_inicio_min)} - ${minutosATexto(config.ventana_tarde_fin_min)}`}
          tone="emerald"
        />
        <Metric label="Tiempo de aviso en pantalla (actual)" value={`${config.aviso_duracion_seg} s`} tone="amber" />
      </section>

      <form onSubmit={guardar} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        <h3 className={`${ui.sectionTitle} mb-6`}>Configuración de escaneos</h3>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label htmlFor="cfg-dias" className={labelClass}>Días mínimos entre escaneos</label>
            <input
              id="cfg-dias"
              type="number"
              inputMode="numeric"
              min="0"
              max="30"
              step="1"
              className={inputClass}
              value={form.dias_minimos_entre_escaneos}
              onChange={(e) => setForm({ ...form, dias_minimos_entre_escaneos: e.target.value })}
              required
            />
            <p className="text-sm text-slate-400 mt-2">Entero de 0 a 30. Con 0 la restricción queda desactivada.</p>
          </div>
          <div>
            <label htmlFor="cfg-guantes" className={labelClass}>Escaneos para aviso de guantes</label>
            <input
              id="cfg-guantes"
              type="number"
              inputMode="numeric"
              min="1"
              max="30"
              step="1"
              className={inputClass}
              value={form.escaneos_aviso_guantes}
              onChange={(e) => setForm({ ...form, escaneos_aviso_guantes: e.target.value })}
              required
            />
            <p className="text-sm text-slate-400 mt-2">Entero de 1 a 30. Se cuenta solo con escaneos válidos.</p>
          </div>
          <div>
            <label htmlFor="cfg-manana-inicio" className={labelClass}>Ventana de registro mañana: inicio</label>
            <input
              id="cfg-manana-inicio"
              type="time"
              className={inputClass}
              value={form.ventana_manana_inicio}
              onChange={(e) => setForm({ ...form, ventana_manana_inicio: e.target.value })}
              required
            />
          </div>
          <div>
            <label htmlFor="cfg-manana-fin" className={labelClass}>Ventana de registro mañana: fin</label>
            <input
              id="cfg-manana-fin"
              type="time"
              className={inputClass}
              value={form.ventana_manana_fin}
              onChange={(e) => setForm({ ...form, ventana_manana_fin: e.target.value })}
              required
            />
          </div>
          <div>
            <label htmlFor="cfg-tarde-inicio" className={labelClass}>Ventana de registro tarde: inicio</label>
            <input
              id="cfg-tarde-inicio"
              type="time"
              className={inputClass}
              value={form.ventana_tarde_inicio}
              onChange={(e) => setForm({ ...form, ventana_tarde_inicio: e.target.value })}
              required
            />
          </div>
          <div>
            <label htmlFor="cfg-tarde-fin" className={labelClass}>Ventana de registro tarde: fin</label>
            <input
              id="cfg-tarde-fin"
              type="time"
              className={inputClass}
              value={form.ventana_tarde_fin}
              onChange={(e) => setForm({ ...form, ventana_tarde_fin: e.target.value })}
              required
            />
            <p className="text-sm text-slate-400 mt-2">Cada ventana incluye sus horas de inicio y fin. El inicio debe ser anterior al fin.</p>
          </div>
          <div>
            <label htmlFor="cfg-aviso" className={labelClass}>Tiempo de aviso en pantalla (segundos)</label>
            <input
              id="cfg-aviso"
              type="number"
              inputMode="numeric"
              min="1"
              max="60"
              step="1"
              className={inputClass}
              value={form.aviso_duracion_seg}
              onChange={(e) => setForm({ ...form, aviso_duracion_seg: e.target.value })}
              required
            />
            <p className="text-sm text-slate-400 mt-2">Entero de 1 a 60. Tiempo que se muestra cada resultado de escaneo en la pantalla.</p>
          </div>
        </div>
        <p className="text-sm text-slate-400">
          Última modificación: {config.updated_by_num || "-"} · {formatDateTime(config.updated_at)}
        </p>
        <button type="submit" disabled={guardando} className={primaryButtonClass}>
          {guardando ? "Guardando..." : "Guardar configuración"}
        </button>
      </form>

      <section className="space-y-4">
        <h3 className={`${ui.sectionTitle} mb-6`}>Historial de cambios</h3>
        {historial.length === 0 ? (
          <p className="text-slate-400 text-lg">Sin cambios registrados.</p>
        ) : (
          <div className="overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl">
            <table className="w-full text-base">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className={thClass}>Fecha y hora</th>
                  <th className={thClass}>Campo</th>
                  <th className={thClass}>Valor anterior</th>
                  <th className={thClass}>Valor nuevo</th>
                  <th className={thClass}>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((h) => (
                  <tr key={h.id} className="border-b border-slate-800">
                    <td className={tdClass}>{formatDateTime(h.changed_at)}</td>
                    <td className={tdClass}>{CONFIG_LABELS[h.campo] || h.campo}</td>
                    <td className={tdClass}>{formatCampoValor(h.campo, h.valor_anterior)}</td>
                    <td className="p-3 font-bold text-white">{formatCampoValor(h.campo, h.valor_nuevo)}</td>
                    <td className={tdClass}>{h.usuario_num_empleado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function TxtComponent({ onClose }) {
  const [session, setSession] = useState(null);
  const [loginForm, setLoginForm] = useState({ num_empleado: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [tab, setTab] = useState("registro");
  const [notice, setNotice] = useState(null);

  const callApi = async (method, path, { data, params } = {}) => {
    try {
      const response = await axios({
        method,
        url: `${API_BASE}${path}`,
        data,
        params,
        headers: { Authorization: `Bearer ${session.token}` },
      });
      return response.data;
    } catch (err) {
      if (err.response?.status === 401) {
        setSession(null);
        setLoginError("Tu sesión expiró. Inicia sesión nuevamente.");
      }
      throw err;
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    if (!loginForm.num_empleado || !loginForm.password) {
      setLoginError("Número de empleado y contraseña requeridos");
      return;
    }
    setLoggingIn(true);
    try {
      const { data } = await axios.post(`${API_BASE}/txt/login`, {
        num_empleado: loginForm.num_empleado,
        password: loginForm.password,
      });
      setSession({ token: data.token, user: data.user, can_authorize: data.can_authorize });
      setLoginForm({ num_empleado: "", password: "" });
      setTab("registro");
    } catch (err) {
      setLoginError(errorText(err, "Error al iniciar sesión"));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (session) {
      try {
        await axios.post(`${API_BASE}/txt/logout`, {}, { headers: { Authorization: `Bearer ${session.token}` } });
      } catch {
        // The session may already be expired on the server
      }
    }
    setSession(null);
    setTab("registro");
    setNotice(null);
  };

  const handleClose = () => {
    handleLogout();
    onClose();
  };

  if (!session) {
    return (
      <Shell title="Horas por tiempo" onClose={onClose}>
        <div className={`max-w-md mx-auto ${ui.panel} p-8`}>
          <h3 className={`${ui.sectionTitle} mb-6`}>Inicio de sesión</h3>
          {loginError && (
            <div role="alert" className="mb-6 border-l-4 border-rose-500/60 bg-rose-500/10 text-rose-200 p-4 text-lg font-medium rounded-xl">
              {loginError}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="txt-num-empleado" className={labelClass}>Número de empleado</label>
              <input
                id="txt-num-empleado"
                className={inputClass}
                autoComplete="username"
                value={loginForm.num_empleado}
                onChange={(e) => setLoginForm({ ...loginForm, num_empleado: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="txt-password" className={labelClass}>Contraseña</label>
              <input
                id="txt-password"
                type="password"
                className={inputClass}
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              />
            </div>
            <button type="submit" disabled={loggingIn} className={`${primaryButtonClass} w-full`}>
              {loggingIn ? "Validando..." : "Entrar"}
            </button>
          </form>
          <p className={`${ui.muted} text-sm mt-6`}>
            La configuración de escaneos (horarios, aviso y días mínimos) se habilita al entrar con el No. 179.
          </p>
        </div>
      </Shell>
    );
  }

  const tabs = [{ id: "registro", label: "Registro" }];
  if (session.user.rol === "Tool Room") {
    tabs.push({ id: "uso_horas", label: "Horas utilizadas" });
  }
  if (session.can_authorize) {
    tabs.push({ id: "autorizacion", label: "Autorización" }, { id: "configuracion", label: "Configuración" });
  }
  if (session.can_authorize || session.user.rol === "Tool Room") {
    tabs.push({ id: "historial", label: "Historial" });
  }

  const changeTab = (id) => {
    setTab(id);
    setNotice(null);
  };

  return (
    <Shell
      title="Horas por tiempo"
      subtitle={`${session.user.nombre} · No. ${session.user.num_empleado} · ${session.user.rol}`}
      actions={<button type="button" onClick={handleLogout} className={buttonClass}>Cerrar sesión</button>}
      onClose={handleClose}
    >
      <nav className="flex flex-wrap gap-2 p-1.5 mb-8 bg-slate-950/80 border border-white/5 rounded-2xl w-fit" aria-label="Pestañas">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => changeTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`px-5 py-3 rounded-xl text-lg font-semibold transition ${
              tab === t.id
                ? "bg-sky-600 text-white shadow-lg shadow-sky-900/40"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <Notice notice={notice} />

      {tab === "registro" && <RegistroTab callApi={callApi} onNotice={setNotice} />}
      {tab === "uso_horas" && session.user.rol === "Tool Room" && <UsoHorasTab callApi={callApi} onNotice={setNotice} />}
      {tab === "autorizacion" && session.can_authorize && <AutorizacionTab callApi={callApi} onNotice={setNotice} />}
      {tab === "configuracion" && session.can_authorize && <ConfiguracionTab callApi={callApi} onNotice={setNotice} />}
      {tab === "historial" && (session.can_authorize || session.user.rol === "Tool Room") && (
        <HistorialTab callApi={callApi} onNotice={setNotice} />
      )}
    </Shell>
  );
}
