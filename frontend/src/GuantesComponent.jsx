import { useEffect, useState } from "react";
import axios from "axios";
import { ui } from "./ui";
import { APP_VERSION } from "./version";

const API_BASE = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:3113/api`;

const buttonClass = ui.button;
const primaryButtonClass = ui.success;
const thClass = ui.th;
const tdClass = ui.td;

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

export default function GuantesComponent({ onClose }) {
  const [avisos, setAvisos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let activo = true;
    axios
      .get(`${API_BASE}/guantes/avisos`)
      .then(({ data }) => {
        if (activo) setAvisos(data.avisos);
      })
      .catch((err) => {
        if (activo) setError(err.response?.data?.error || "No se pudo cargar el registro de guantes");
      })
      .finally(() => {
        if (activo) setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/90 backdrop-blur-sm p-4 md:p-8">
      <div className={`max-w-5xl mx-auto ${ui.card} p-6 md:p-8`}>
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8 border-b border-white/5 pb-6">
          <div>
            <h2 className={ui.heading}>Guantes</h2>
            <p className={`${ui.muted} mt-1`}>Registro de cada aviso de cambio de guantes</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={`${API_BASE}/guantes/avisos/excel`}
              download
              className={primaryButtonClass}
            >
              Descargar Excel
            </a>
            <button type="button" onClick={onClose} className={buttonClass}>Cerrar</button>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-6 border-l-4 rounded-xl px-5 py-4 text-lg font-medium border-rose-500/60 bg-rose-500/10 text-rose-200">
            {error}
          </div>
        )}

        {avisos.length === 0 ? (
          <p className="text-slate-400 text-lg">
            {cargando ? "Cargando..." : error ? "" : "No hay avisos de cambio de guantes registrados."}
          </p>
        ) : (
          <div className="overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl">
            <table className="w-full text-base">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className={thClass}>Cuándo se avisó</th>
                  <th className={thClass}>Empleado a quien se avisó</th>
                  <th className={thClass}>Escaneos al avisar</th>
                </tr>
              </thead>
              <tbody>
                {avisos.map((a) => (
                  <tr key={a.id} className="border-b border-slate-800">
                    <td className={tdClass}>{formatDateTime(a.avisado_at)}</td>
                    <td className={tdClass}>
                      <span className="font-semibold text-white">{a.empleado_nombre || "-"}</span>
                      <br />
                      <span className="text-slate-400">No. {a.empleado_num}</span>
                    </td>
                    <td className={tdClass}>{a.escaneos_umbral}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-8 pt-4 border-t border-white/5 text-center text-xs tracking-wider text-slate-500">
          Control Asistencia · Versión {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
