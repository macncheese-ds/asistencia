import { useState, useRef, useEffect } from "react";
import axios from "axios";

// Configure axios for CORS
axios.defaults.headers.common["Content-Type"] = "application/json";
axios.defaults.headers.post["Content-Type"] = "application/json";
axios.defaults.withCredentials = false;

function formatScanTime(date) {
  if (!date) return "--:--:--";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "--:--:--" : parsed.toLocaleTimeString();
}

function App() {
  const [scannedData, setScannedData] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [registrations, setRegistrations] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [scanModal, setScanModal] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [downloadTurn, setDownloadTurn] = useState("all");
  const [currentTurn, setCurrentTurn] = useState({ turn: 1, name: "TURNO MAÑANA", withinWindow: false });
  const inputRef = useRef(null);
  const scanModalRef = useRef(null);
  
  const API_BASE = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:3113/api`;
  const SCAN_ENDPOINT = `${API_BASE}/attendance/log`;

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
    if (!showModal) {
      const interval = setInterval(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [showModal]);

  useEffect(() => {
    if (scanModal) {
      const timer = setTimeout(() => {
        setScanModal(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [scanModal]);

  const handleScan = async (e) => {
    e.preventDefault();
    if (!scannedData) return;
    
    setIsScanning(true);
    
    try {
      const response = await axios.post(SCAN_ENDPOINT, { num_empleado: scannedData });
      setScanModal({
        full_name: response.data.user.full_name,
        area: response.data.user.area,
        time: new Date().toLocaleTimeString()
      });
    } catch (err) {
      setScanModal({
        error: err.response?.data?.error || "Error al registrar",
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
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  return (
    <div className="min-h-screen bg-black text-white p-4">
      {scanModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in">
          <div className={`bg-gray-950 p-6 rounded-sm shadow-lg border text-center max-w-sm animate-zoom-in ${
            scanModal.error ? 'border-gray-700' : 'border-gray-700'
          }`}>
            {scanModal.error ? (
              <>
                <h2 className="text-lg font-semibold text-gray-300 mb-2">Error</h2>
                <p className="text-gray-400 text-sm">{scanModal.error}</p>
              </>
            ) : (
              <>
                <div className="mb-3">
                  <div className="w-10 h-10 mx-auto mb-3 bg-gray-800 border border-gray-700 rounded-full flex items-center justify-center animate-zoom-in" style={{animationDelay: '0.1s'}}>
                    <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-gray-100">Registrado</h2>
                </div>
                <div className="space-y-1 text-left text-xs">
                  <p className="text-gray-400"><span className="text-gray-300">Nombre:</span> {scanModal.full_name}</p>
                  <p className="text-gray-400"><span className="text-gray-300">Área:</span> {scanModal.area || '-'}</p>
                  <p className="text-gray-500">Hora: {scanModal.time}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {!showModal ? (
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
            <h1 className="text-2xl font-light">Control Asistencia</h1>
            <button onClick={handleOpenModal} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-sm text-sm font-medium transition">
              Reportes
            </button>
          </div>
          <div className={`p-4 border-b mb-6 text-center ${currentTurn.withinWindow ? "border-gray-700" : "border-gray-600"}`}>
            <h2 className="text-lg font-light text-gray-200">{currentTurn.name}</h2>
            <p className="mt-2 text-xs text-gray-500">{currentTurn.withinWindow ? "ACTIVO" : "INACTIVO"}</p>
          </div>
          <div className="bg-gray-950 border border-gray-800 p-6 rounded-sm">
            <h1 className="text-2xl font-light mb-6 text-center text-gray-100">Escanea Badge</h1>
            <form onSubmit={handleScan}>
              <input 
                ref={inputRef} 
                type="text" 
                className={`w-full bg-gray-900 border rounded-sm p-3 text-center text-white focus:outline-none placeholder-gray-600 transition-all ${
                  isScanning ? 'border-gray-600 animate-pulse' : 'border-gray-700 focus:border-gray-600'
                }`}
                placeholder={isScanning ? "Procesando..." : "Escanea aqui..."} 
                value={scannedData} 
                onChange={(e) => setScannedData(e.target.value)} 
                disabled={isScanning}
                autoFocus 
              />
              {isScanning && (
                <div className="mt-4 flex justify-center">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0s'}}></div>
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></div>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto">
          <div className="bg-gray-950 border border-gray-800 p-6 rounded-sm">
            <div className="flex justify-between mb-6 border-b border-gray-800 pb-4">
              <h2 className="text-2xl font-light">Reportes</h2>
              <button onClick={handleCloseModal} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-sm text-sm font-medium transition">Cerrar</button>
            </div>
            {!registrations ? (
              <div className="bg-gray-900 border border-gray-800 p-6 rounded-sm">
                <h3 className="text-lg font-light mb-6">Credenciales</h3>
                {loginError && <div className="mb-4 border-l border-gray-700 bg-gray-900 text-gray-400 p-2 text-sm">{loginError}</div>}
                <form onSubmit={handleLogin} className="space-y-4">
                  <input type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-sm p-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 text-sm" placeholder="Usuario" />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-sm p-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 text-sm" placeholder="Contraseña" />
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-300">Fecha</label>
                    <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-sm p-3 text-white focus:outline-none focus:border-gray-600 text-sm" />
                  </div>
                  <button type="submit" className="w-full bg-gray-800 hover:bg-gray-700 text-white font-medium py-2 rounded-sm text-sm transition">ENTRAR</button>
                </form>
              </div>
            ) : (
              <div>
                <div className="mb-6">
                  <p className="text-sm font-light mb-4">Fecha: <span className="text-gray-300">{registrations.date}</span> | Área: <span className="text-gray-300">{registrations.userArea}</span></p>
                  <button onClick={handleDownload} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-sm text-sm font-medium transition">Descargar Excel</button>
                </div>
                <div className="mb-6">
                  <h4 className="font-light text-lg mb-2 text-gray-200">Turno Mañana</h4>
                  <p className="text-xs text-gray-500 mb-2">{registrations.turn_1.time}</p>
                  <div className="bg-gray-900 rounded-sm border border-gray-800 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-gray-800 bg-gray-900"><tr><th className="p-2 text-left font-medium text-gray-400">Num Empleado</th><th className="p-2 text-left font-medium text-gray-400">Nombre</th></tr></thead>
                      <tbody>{registrations.turn_1.data.map((l, i) => <tr key={i} className="border-b border-gray-800"><td className="p-2 text-gray-400">{l.num_empleado}</td><td className="p-2 text-gray-400">{l.full_name}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Total: {registrations.turn_1.registrations}</p>
                </div>
                <div className="mb-6">
                  <h4 className="font-light text-lg mb-2 text-gray-200">Turno Tarde</h4>
                  <p className="text-xs text-gray-500 mb-2">{registrations.turn_2.time}</p>
                  <div className="bg-gray-900 rounded-sm border border-gray-800 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-gray-800 bg-gray-900"><tr><th className="p-2 text-left font-medium text-gray-400">Num Empleado</th><th className="p-2 text-left font-medium text-gray-400">Nombre</th></tr></thead>
                      <tbody>{registrations.turn_2.data.map((l, i) => <tr key={i} className="border-b border-gray-800"><td className="p-2 text-gray-400">{l.num_empleado}</td><td className="p-2 text-gray-400">{l.full_name}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Total: {registrations.turn_2.registrations}</p>
                </div>
                <div className="text-center bg-gray-900 p-4 rounded-sm border border-gray-800 font-light text-sm">Total Día: <span className="text-gray-300">{registrations.total}</span></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;