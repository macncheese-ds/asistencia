import { useState, useRef, useEffect } from "react";
import axios from "axios";
import TxtComponent from "./TxtComponent";
import GuantesComponent from "./GuantesComponent";
import { APP_VERSION } from "./version";
import { fechaHoySaltillo, horaSaltillo } from "./zonaHoraria";

// Configure axios for CORS
axios.defaults.headers.common["Content-Type"] = "application/json";
axios.defaults.headers.post["Content-Type"] = "application/json";
axios.defaults.withCredentials = false;

function formatScanTime(date) {
  if (!date) return "--:--:--";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "--:--:--" : parsed.toLocaleTimeString();
}

const DEFAULT_SCAN_DISPLAY_MS = 5000;
let nextScanId = 1;

function EmployeeHeader({ name, num }) {
  return (
    <div className="bg-slate-950/60 border border-white/5 ring-1 ring-white/5 rounded-2xl p-6 mb-6 text-center">
      <p className="text-4xl md:text-5xl font-extrabold text-white break-words leading-tight">{name}</p>
      <p className="text-2xl md:text-3xl font-bold text-sky-300 mt-3">No. {num}</p>
    </div>
  );
}

function App() {
  const [scannedData, setScannedData] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showTxtModal, setShowTxtModal] = useState(false);
  const [showGuantesModal, setShowGuantesModal] = useState(false);
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [registrations, setRegistrations] = useState(null);
  const [selectedDate, setSelectedDate] = useState(fechaHoySaltillo());
  const [scanQueue, setScanQueue] = useState([]);
  const scanModal = scanQueue[0] || null;
  const [isScanning, setIsScanning] = useState(false);
  const [downloadTurn, setDownloadTurn] = useState("all");
  const [currentTurn, setCurrentTurn] = useState({ turn: 1, name: "TURNO MAÑANA", withinWindow: false });
  const [scanDisplayMs, setScanDisplayMs] = useState(DEFAULT_SCAN_DISPLAY_MS);
  const [horaActual, setHoraActual] = useState(() => horaSaltillo());
  const inputRef = useRef(null);
  const scanModalRef = useRef(null);
  
  const API_BASE = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:3113/api`;
  const SCAN_ENDPOINT = `${API_BASE}/attendance/log`;

  useEffect(() => {
    const timer = setInterval(() => setHoraActual(horaSaltillo()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch current server time and turn
  useEffect(() => {
    const fetchCurrentTurn = async () => {
      try {
        const response = await axios.get(`${API_BASE}/time/current`);
        setCurrentTurn({
          turn: response.data.turn,
          name: response.data.turnName,
          withinWindow: response.data.withinWindow
        });
        const avisoSeg = Number(response.data.aviso_duracion_seg);
        if (Number.isFinite(avisoSeg) && avisoSeg > 0) {
          setScanDisplayMs(avisoSeg * 1000);
        }
      } catch (error) {
        console.error('Error fetching current turn:', error);
        // Keep previous value on error
      }
    };

    // Fetch immediately
    fetchCurrentTurn();

    // Fetch every second to stay in sync
    const interval = setInterval(fetchCurrentTurn, 1000);
    return () => clearInterval(interval);
  }, [API_BASE]);

  useEffect(() => {
    if (!showModal && !showTxtModal) {
      const interval = setInterval(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [showModal, showTxtModal]);

  // The head of the queue stays on screen for scanDisplayMs (configured by the engineer) before the next result is shown
  const headScanId = scanQueue[0]?.id;
  useEffect(() => {
    if (headScanId === undefined) return;
    const timer = setTimeout(() => {
      setScanQueue((queue) => queue.slice(1));
    }, scanDisplayMs);
    return () => clearTimeout(timer);
  }, [headScanId, scanDisplayMs]);

  // A regular result is replaced by the newest one, but a glove warning is never replaced before it has been shown
  const pushScanResult = (item) => {
    setScanQueue((queue) => {
      const [head, ...rest] = queue;
      if (!head) return [item];
      if (!head.aviso_guantes) {
        return [item, ...rest.filter((queued) => queued.aviso_guantes)];
      }
      const last = rest[rest.length - 1];
      if (last && !last.aviso_guantes) {
        return [head, ...rest.slice(0, -1), item];
      }
      return [head, ...rest, item];
    });
  };

  const handleScan = async (e) => {
    e.preventDefault();
    if (!scannedData) return;
    
    setIsScanning(true);
    
    try {
      const response = await axios.post(SCAN_ENDPOINT, { num_empleado: scannedData });
      const { user, aviso_guantes } = response.data;
      pushScanResult({
        id: nextScanId++,
        full_name: user.full_name,
        num_empleado: user.num_empleado,
        area: user.area,
        gaveta: user.gaveta,
        posicion: user.posicion,
        aviso_guantes: Boolean(aviso_guantes),
        time: new Date().toLocaleTimeString()
      });
    } catch (err) {
      const data = err.response?.data;
      pushScanResult({
        id: nextScanId++,
        error: data?.error || "Error al registrar",
        full_name: data?.user?.full_name,
        num_empleado: data?.user?.num_empleado,
        aviso_guantes: false,
        time: new Date().toLocaleTimeString()
      });
    } finally {
      setIsScanning(false);
    }
    setScannedData("");
  };

  const handleOpenModal = () => {
    setShowModal(true);
    setLoginError("");
    setRegistrations(null);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    if (!usuario || !password) {
      setLoginError("Usuario y contraseña requeridos");
      return;
    }
    try {
      const response = await axios.post(`${API_BASE}/registrations/today`, {
        usuario,
        password,
        date: selectedDate
      });
      setRegistrations(response.data);
    } catch (err) {
      setLoginError(err.response?.data?.error || "Error al autenticar");
    }
  };

  const handleDownload = async () => {
    try {
      const response = await axios.post(`${API_BASE}/registrations/download`, {
        usuario,
        password,
        date: selectedDate,
        turn: downloadTurn
      }, {
        responseType: "blob"
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const turnLabel = downloadTurn === 'all' ? 'completo' : `turno${downloadTurn}`;
      link.setAttribute("download", `asistencia-${selectedDate}-${turnLabel}.xlsx`);
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      link.parentNode.removeChild(link);
    } catch (err) {
      setLoginError("Error descargando archivo");
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setUsuario("");
    setPassword("");
    setLoginError("");
    setRegistrations(null);
    setSelectedDate(fechaHoySaltillo());
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 antialiased p-4 md:p-6">
      {showTxtModal && <TxtComponent onClose={() => setShowTxtModal(false)} />}
      {showGuantesModal && <GuantesComponent onClose={() => setShowGuantesModal(false)} />}

      {scanModal && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className={`bg-slate-900 p-6 md:p-10 rounded-3xl shadow-2xl border-2 text-center w-full max-w-2xl animate-zoom-in ${
            scanModal.error ? 'border-rose-500/70' : 'border-emerald-500/70'
          }`}>
            {scanModal.error ? (
              <>
                <div className="w-20 h-20 mx-auto mb-6 bg-rose-500/15 border-2 border-rose-500/60 rounded-full flex items-center justify-center">
                  <svg className="w-10 h-10 text-rose-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-rose-300 mb-4">Error</h2>
                {scanModal.full_name && <EmployeeHeader name={scanModal.full_name} num={scanModal.num_empleado} />}
                <p className="text-slate-200 text-2xl font-semibold">{scanModal.error}</p>
              </>
            ) : (
              <>
                {scanModal.aviso_guantes && (
                  <div role="alert" className="mb-6 bg-amber-400 text-slate-950 rounded-2xl p-6 border-4 border-amber-200 shadow-lg shadow-amber-900/40">
                    <p className="text-3xl md:text-4xl font-black leading-tight">Debes pasar a Tool Room por guantes nuevos.</p>
                  </div>
                )}
                <div className="mb-6">
                  <div className="w-20 h-20 mx-auto mb-4 bg-emerald-500/15 border-2 border-emerald-500/60 rounded-full flex items-center justify-center animate-zoom-in" style={{animationDelay: '0.1s'}}>
                    <svg className="w-10 h-10 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path>
                    </svg>
                  </div>
                  <h2 className="text-3xl font-bold text-emerald-300 tracking-wide">REGISTRADO</h2>
                </div>

                <EmployeeHeader name={scanModal.full_name} num={scanModal.num_empleado} />

                {/* Gaveta y posición: datos principales para el operador */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center bg-slate-900 rounded-xl py-4">
                      <p className="text-slate-400 text-sm font-semibold uppercase tracking-widest mb-2">Gaveta</p>
                      <p className="text-6xl font-black text-white">{scanModal.gaveta}</p>
                    </div>
                    <div className="text-center bg-slate-900 rounded-xl py-4">
                      <p className="text-slate-400 text-sm font-semibold uppercase tracking-widest mb-2">Posición</p>
                      <p className="text-6xl font-black text-white">{scanModal.posicion}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-left text-lg">
                  <p className="text-slate-300"><span className="text-slate-400">Área:</span> <span className="font-semibold text-white">{scanModal.area || '-'}</span></p>
                  <p className="text-slate-400 text-base mt-4">Hora: {scanModal.time}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!showModal ? (
        <div className="w-full max-w-3xl mx-auto flex-1">
          <header className="flex flex-wrap justify-between items-center gap-4 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-lg shadow-sky-900/50 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Control Asistencia</h1>
                <p className="text-sm text-slate-400">Registro de entradas por badge</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowTxtModal(true)} className="bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-white px-5 py-2.5 rounded-xl text-base font-semibold transition duration-200 active:scale-[0.98]">
                Txt
              </button>
              <button onClick={() => setShowGuantesModal(true)} className="bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-white px-5 py-2.5 rounded-xl text-base font-semibold transition duration-200 active:scale-[0.98]">
                Guantes
              </button>
              <button onClick={handleOpenModal} className="bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-white px-5 py-2.5 rounded-xl text-base font-semibold transition duration-200 active:scale-[0.98]">
                Reportes
              </button>
            </div>
          </header>
          <div className={`rounded-2xl border p-6 mb-8 text-center bg-slate-900/70 backdrop-blur-xl shadow-xl shadow-black/30 transition duration-300 ${currentTurn.withinWindow ? "border-emerald-500/40 ring-1 ring-emerald-500/20" : "border-white/5"}`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Hora actual · Saltillo, Coahuila</p>
            <p className="text-5xl font-black tabular-nums tracking-tight text-white mb-6">{horaActual}</p>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Turno actual</p>
            <h2 className="text-2xl font-bold text-white">{currentTurn.name}</h2>
            <span className={`inline-flex items-center gap-2 mt-4 px-3 py-1 rounded-full text-xs font-bold tracking-widest border ${currentTurn.withinWindow ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300" : "bg-slate-800 border-slate-700 text-slate-400"}`}>
              <span className={`w-2 h-2 rounded-full ${currentTurn.withinWindow ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`}></span>
              {currentTurn.withinWindow ? "ACTIVO" : "INACTIVO"}
            </span>
          </div>
          <div className="bg-slate-900/70 backdrop-blur-xl border border-white/5 ring-1 ring-white/5 shadow-2xl shadow-black/50 p-8 md:p-12 rounded-3xl">
            <h1 className="text-2xl font-semibold mb-8 text-center text-slate-100">Escanea tu badge</h1>
            <form onSubmit={handleScan}>
              <input
                ref={inputRef}
                type="text"
                className={`w-full bg-slate-950/80 border-2 rounded-2xl p-5 text-center text-2xl text-white focus:outline-none focus:ring-4 focus:ring-sky-500/20 placeholder-slate-500 transition-all duration-200 ${
                  isScanning ? 'border-slate-600 animate-pulse' : 'border-slate-700 focus:border-sky-500'
                }`}
                placeholder={isScanning ? "Procesando..." : "Escanea aqui..."}
                value={scannedData}
                onChange={(e) => setScannedData(e.target.value)}
                disabled={isScanning}
                autoFocus
              />
              {isScanning && (
                <div className="mt-6 flex justify-center">
                  <div className="flex space-x-3">
                    <div className="w-4 h-4 bg-sky-400 rounded-full animate-bounce" style={{animationDelay: '0s'}}></div>
                    <div className="w-4 h-4 bg-sky-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    <div className="w-4 h-4 bg-sky-400 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></div>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-5xl mx-auto flex-1">
          <div className="bg-slate-900/70 backdrop-blur-xl border border-white/5 ring-1 ring-white/5 shadow-2xl shadow-black/50 p-6 md:p-8 rounded-3xl">
            <div className="flex flex-wrap justify-between items-center gap-4 mb-8 border-b border-slate-800 pb-6">
              <h2 className="text-3xl font-semibold tracking-tight">Reportes</h2>
              <button onClick={handleCloseModal} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white px-6 py-3 rounded-xl text-lg font-medium transition">Cerrar</button>
            </div>
            {!registrations ? (
              <div className="max-w-md mx-auto bg-slate-900 border border-slate-800 p-8 rounded-2xl">
                <h3 className="text-2xl font-semibold mb-6">Credenciales</h3>
                {loginError && <div role="alert" className="mb-6 border-l-4 border-rose-500/60 bg-rose-500/10 text-rose-200 p-4 text-lg rounded-xl">{loginError}</div>}
                <form onSubmit={handleLogin} className="space-y-5">
                  <input type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-lg text-white placeholder-slate-500 transition focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500" placeholder="Usuario" />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-lg text-white placeholder-slate-500 transition focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500" placeholder="Contraseña" />
                  <div>
                    <label className="block text-base font-medium mb-2 text-slate-300">Fecha</label>
                    <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-lg text-white transition focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500" />
                  </div>
                  <button type="submit" className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold py-3 rounded-xl text-lg shadow-lg shadow-sky-900/40 transition">ENTRAR</button>
                </form>
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                  <p className="text-lg text-slate-300">Fecha: <span className="font-semibold text-white">{registrations.date}</span> <span className="text-slate-500">|</span> Área: <span className="font-semibold text-white">{registrations.userArea}</span></p>
                  <button onClick={handleDownload} className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl text-lg font-semibold shadow-lg shadow-emerald-900/40 transition">Descargar Excel</button>
                </div>
                <div className="mb-8">
                  <h4 className="font-semibold text-2xl mb-2 text-slate-100">Turno Mañana</h4>
                  <p className="text-sm text-slate-400 mb-3">{registrations.turn_1.time}</p>
                  <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-auto">
                    <table className="w-full text-base">
                      <thead className="border-b border-slate-800 bg-slate-900">
                        <tr>
                          <th className="p-3 text-left text-sm font-semibold uppercase tracking-wider text-slate-400">Num Empleado</th>
                          <th className="p-3 text-left text-sm font-semibold uppercase tracking-wider text-slate-400">Nombre</th>
                          <th className="p-3 text-center text-sm font-semibold uppercase tracking-wider text-slate-400">Gaveta</th>
                          <th className="p-3 text-center text-sm font-semibold uppercase tracking-wider text-slate-400">Posición</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registrations.turn_1.data.map((l, i) => (
                          <tr key={i} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/40">
                            <td className="p-3 text-slate-400">{l.num_empleado}</td>
                            <td className="p-3 text-slate-200">{l.full_name}</td>
                            <td className="p-3 text-center text-white font-bold text-lg">{l.gaveta || '-'}</td>
                            <td className="p-3 text-center text-white font-bold text-lg">{l.posicion || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-sm text-slate-400">Total: <span className="font-semibold text-slate-200">{registrations.turn_1.registrations}</span></p>
                </div>
                <div className="mb-8">
                  <h4 className="font-semibold text-2xl mb-2 text-slate-100">Turno Tarde</h4>
                  <p className="text-sm text-slate-400 mb-3">{registrations.turn_2.time}</p>
                  <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-auto">
                    <table className="w-full text-base">
                      <thead className="border-b border-slate-800 bg-slate-900">
                        <tr>
                          <th className="p-3 text-left text-sm font-semibold uppercase tracking-wider text-slate-400">Num Empleado</th>
                          <th className="p-3 text-left text-sm font-semibold uppercase tracking-wider text-slate-400">Nombre</th>
                          <th className="p-3 text-center text-sm font-semibold uppercase tracking-wider text-slate-400">Gaveta</th>
                          <th className="p-3 text-center text-sm font-semibold uppercase tracking-wider text-slate-400">Posición</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registrations.turn_2.data.map((l, i) => (
                          <tr key={i} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/40">
                            <td className="p-3 text-slate-400">{l.num_empleado}</td>
                            <td className="p-3 text-slate-200">{l.full_name}</td>
                            <td className="p-3 text-center text-white font-bold text-lg">{l.gaveta || '-'}</td>
                            <td className="p-3 text-center text-white font-bold text-lg">{l.posicion || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-sm text-slate-400">Total: <span className="font-semibold text-slate-200">{registrations.turn_2.registrations}</span></p>
                </div>
                <div className="text-center bg-slate-900 p-6 rounded-xl border border-slate-800 text-lg">Total Día: <span className="text-sky-300 font-bold text-2xl">{registrations.total}</span></div>
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="mt-8 pt-4 text-center text-xs tracking-wider text-slate-500">
        Control Asistencia · Versión {APP_VERSION}
      </footer>
    </div>
  );
}

export default App;