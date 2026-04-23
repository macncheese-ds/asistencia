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
      }, 5000);
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
        gaveta: response.data.user.gaveta,
        posicion: response.data.user.posicion,
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
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 animate-fade-in">
          <div className={`bg-gray-950 p-8 md:p-12 rounded-lg shadow-2xl border-2 text-center w-full max-w-xl mx-4 animate-zoom-in ${
            scanModal.error ? 'border-red-800' : 'border-emerald-800'
          }`}>
            {scanModal.error ? (
              <>
                <div className="w-20 h-20 mx-auto mb-6 bg-red-950 border-2 border-red-800 rounded-full flex items-center justify-center">
                  <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-red-400 mb-4">Error</h2>
                <p className="text-gray-300 text-xl">{scanModal.error}</p>
              </>
            ) : (
              <>
                <div className="mb-6">
                  <div className="w-20 h-20 mx-auto mb-4 bg-emerald-950 border-2 border-emerald-800 rounded-full flex items-center justify-center animate-zoom-in" style={{animationDelay: '0.1s'}}>
                    <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path>
                    </svg>
                  </div>
                  <h2 className="text-3xl font-bold text-emerald-400">REGISTRADO</h2>
                </div>

                {/* Gaveta & Posición - BIG and prominent */}
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <p className="text-gray-500 text-sm uppercase tracking-widest mb-1">Gaveta</p>
                      <p className="text-6xl font-black text-white">{scanModal.gaveta}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gray-500 text-sm uppercase tracking-widest mb-1">Posición</p>
                      <p className="text-6xl font-black text-white">{scanModal.posicion}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-left text-lg">
                  <p className="text-gray-300"><span className="text-gray-500">Nombre:</span> <span className="font-semibold text-white">{scanModal.full_name}</span></p>
                  <p className="text-gray-300"><span className="text-gray-500">Área:</span> <span className="font-semibold text-white">{scanModal.area || '-'}</span></p>
                  <p className="text-gray-600 text-base mt-4">Hora: {scanModal.time}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {!showModal ? (
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-6">
            <h1 className="text-4xl font-light tracking-tight">Control Asistencia</h1>
            <button onClick={handleOpenModal} className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-md text-lg font-medium transition">
              Reportes
            </button>
          </div>
          <div className={`p-6 border-b mb-8 text-center ${currentTurn.withinWindow ? "border-emerald-800" : "border-gray-700"}`}>
            <h2 className="text-2xl font-light text-gray-200">{currentTurn.name}</h2>
            <p className={`mt-3 text-sm font-semibold tracking-widest ${currentTurn.withinWindow ? "text-emerald-500" : "text-gray-600"}`}>
              {currentTurn.withinWindow ? "● ACTIVO" : "○ INACTIVO"}
            </p>
          </div>
          <div className="bg-gray-950 border border-gray-800 p-8 md:p-12 rounded-lg">
            <h1 className="text-3xl font-light mb-8 text-center text-gray-100">Escanea Badge</h1>
            <form onSubmit={handleScan}>
              <input 
                ref={inputRef} 
                type="text" 
                className={`w-full bg-gray-900 border-2 rounded-md p-5 text-center text-2xl text-white focus:outline-none placeholder-gray-600 transition-all ${
                  isScanning ? 'border-gray-600 animate-pulse' : 'border-gray-700 focus:border-gray-500'
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
                    <div className="w-4 h-4 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0s'}}></div>
                    <div className="w-4 h-4 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    <div className="w-4 h-4 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></div>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto">
          <div className="bg-gray-950 border border-gray-800 p-6 md:p-8 rounded-lg">
            <div className="flex justify-between mb-8 border-b border-gray-800 pb-6">
              <h2 className="text-3xl font-light">Reportes</h2>
              <button onClick={handleCloseModal} className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-md text-lg font-medium transition">Cerrar</button>
            </div>
            {!registrations ? (
              <div className="bg-gray-900 border border-gray-800 p-8 rounded-lg">
                <h3 className="text-2xl font-light mb-8">Credenciales</h3>
                {loginError && <div className="mb-6 border-l-2 border-red-800 bg-gray-900 text-red-400 p-4 text-lg">{loginError}</div>}
                <form onSubmit={handleLogin} className="space-y-6">
                  <input type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-4 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-lg" placeholder="Usuario" />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-4 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-lg" placeholder="Contraseña" />
                  <div>
                    <label className="block text-lg font-medium mb-3 text-gray-300">Fecha</label>
                    <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-4 text-white focus:outline-none focus:border-gray-500 text-lg" />
                  </div>
                  <button type="submit" className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold py-4 rounded-md text-lg transition">ENTRAR</button>
                </form>
              </div>
            ) : (
              <div>
                <div className="mb-8">
                  <p className="text-lg font-light mb-4">Fecha: <span className="text-gray-300">{registrations.date}</span> | Área: <span className="text-gray-300">{registrations.userArea}</span></p>
                  <button onClick={handleDownload} className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-md text-lg font-medium transition">Descargar Excel</button>
                </div>
                <div className="mb-8">
                  <h4 className="font-light text-2xl mb-3 text-gray-200">Turno Mañana</h4>
                  <p className="text-sm text-gray-500 mb-3">{registrations.turn_1.time}</p>
                  <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-auto">
                    <table className="w-full text-base">
                      <thead className="border-b border-gray-800 bg-gray-900">
                        <tr>
                          <th className="p-3 text-left font-semibold text-gray-400">Num Empleado</th>
                          <th className="p-3 text-left font-semibold text-gray-400">Nombre</th>
                          <th className="p-3 text-center font-semibold text-gray-400">Gaveta</th>
                          <th className="p-3 text-center font-semibold text-gray-400">Posición</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registrations.turn_1.data.map((l, i) => (
                          <tr key={i} className="border-b border-gray-800">
                            <td className="p-3 text-gray-400">{l.num_empleado}</td>
                            <td className="p-3 text-gray-300">{l.full_name}</td>
                            <td className="p-3 text-center text-white font-bold text-lg">{l.gaveta || '-'}</td>
                            <td className="p-3 text-center text-white font-bold text-lg">{l.posicion || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-sm text-gray-500">Total: {registrations.turn_1.registrations}</p>
                </div>
                <div className="mb-8">
                  <h4 className="font-light text-2xl mb-3 text-gray-200">Turno Tarde</h4>
                  <p className="text-sm text-gray-500 mb-3">{registrations.turn_2.time}</p>
                  <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-auto">
                    <table className="w-full text-base">
                      <thead className="border-b border-gray-800 bg-gray-900">
                        <tr>
                          <th className="p-3 text-left font-semibold text-gray-400">Num Empleado</th>
                          <th className="p-3 text-left font-semibold text-gray-400">Nombre</th>
                          <th className="p-3 text-center font-semibold text-gray-400">Gaveta</th>
                          <th className="p-3 text-center font-semibold text-gray-400">Posición</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registrations.turn_2.data.map((l, i) => (
                          <tr key={i} className="border-b border-gray-800">
                            <td className="p-3 text-gray-400">{l.num_empleado}</td>
                            <td className="p-3 text-gray-300">{l.full_name}</td>
                            <td className="p-3 text-center text-white font-bold text-lg">{l.gaveta || '-'}</td>
                            <td className="p-3 text-center text-white font-bold text-lg">{l.posicion || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-sm text-gray-500">Total: {registrations.turn_2.registrations}</p>
                </div>
                <div className="text-center bg-gray-900 p-6 rounded-lg border border-gray-800 font-light text-lg">Total Día: <span className="text-gray-300 font-semibold">{registrations.total}</span></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;