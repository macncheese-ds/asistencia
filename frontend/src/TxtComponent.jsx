import { useState, useEffect } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:3113/api`;

// Helper function to convert minutes to hours and minutes
function minutesToTime(minutes) {
  const isNegative = minutes < 0;
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  return { 
    hours: isNegative ? -hours : hours, 
    minutes: mins,
    isNegative
  };
}

// Helper function to convert hours and minutes to total minutes
function timeToMinutes(hours, minutes) {
  return (parseInt(hours) || 0) * 60 + (parseInt(minutes) || 0);
}

function TxtComponent({ onClose }) {
  const [mode, setMode] = useState(null); // 'edit', 'view', or 'viewer'
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  
  // Auth form
  const [num_empleado, setNumEmpleado] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  
  // Admin edit mode
  const [adminEmpleado, setAdminEmpleado] = useState("");
  const [adminEmpleadoData, setAdminEmpleadoData] = useState([]);
  const [adminEmpleadoTotal, setAdminEmpleadoTotal] = useState(0);
  const [adminSearchError, setAdminSearchError] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  
  // Data for view mode (user records)
  const [records, setRecords] = useState([]);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [totalUsadas, setTotalUsadas] = useState(0);
  const [saldoMinutes, setSaldoMinutes] = useState(0);
  
  // Viewer mode data (all employees)
  const [allRecords, setAllRecords] = useState([]);
  const [viewerGrouped, setViewerGrouped] = useState({});
  const [empleadoNames, setEmpleadoNames] = useState({});
  
  // Form for adding/editing records
  const [newRecord, setNewRecord] = useState({
    week: "",
    hours: "",
    minutes: "",
    comentarios: ""
  });
  
  // Comment editing state
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [commentText, setCommentText] = useState("");
  
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Login handler
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    
    if (!num_empleado || !password) {
      setAuthError("Usuario y contraseña requeridos");
      return;
    }

    try {
      // Try admin auth first
      const adminResponse = await axios.post(`${API_BASE}/txt/admin/auth`, {
        num_empleado,
        password
      });

      if (adminResponse.data.success) {
        setMode("edit");
        setCurrentUser(adminResponse.data.user);
        setIsAuthenticated(true);
        return;
      }
    } catch (err) {
      // Admin auth failed, try viewer auth
      try {
        const viewerResponse = await axios.post(`${API_BASE}/txt/viewer/auth`, {
          num_empleado,
          password
        });

        if (viewerResponse.data.success) {
          setMode("viewer");
          setCurrentUser(viewerResponse.data.user);
          setIsAuthenticated(true);
          
          // Fetch all records for viewer
          const recordsResponse = await axios.post(`${API_BASE}/txt/viewer/records`, {
            num_empleado,
            password
          });
          
          if (recordsResponse.data.success) {
            setAllRecords(recordsResponse.data.records);
            setViewerGrouped(recordsResponse.data.grouped);
            setEmpleadoNames(recordsResponse.data.empleadoNames || {});
          }
          return;
        }
      } catch (viewerErr) {
        // Viewer auth failed, try user auth
        try {
          const userResponse = await axios.post(`${API_BASE}/txt/view`, {
            num_empleado,
            pass_hash: password
          });

          if (userResponse.data.success) {
            setMode("view");
            setCurrentUser(userResponse.data.user);
            setIsAuthenticated(true);
            setRecords(userResponse.data.records);
            setTotalMinutes(userResponse.data.totalMinutes);
            setTotalUsadas(userResponse.data.totalUsadas);
            setSaldoMinutes(userResponse.data.saldoMinutes);
            return;
          }
        } catch (viewErr) {
          setAuthError("Credenciales inválidas");
        }
      }
    }
  };

  // Fetch employee data (admin)
  const handleSearchEmpleado = async () => {
    setAdminSearchError("");
    setAdminEmpleadoData([]);
    
    if (!adminEmpleado.trim()) {
      setAdminSearchError("Ingresa un número de empleado");
      return;
    }

    setAdminLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/txt/admin/records`, {
        num_empleado,
        password
      });

      if (response.data.success) {
        const empleadoRecords = response.data.grouped[adminEmpleado] || [];
        setAdminEmpleadoData(empleadoRecords);
        setEmpleadoNames(response.data.empleadoNames || {});
        
        // Calculate total saldo (generados - gastados)
        const totalSaldo = empleadoRecords.reduce((sum, r) => sum + (r.hours || 0) - (r.usadas || 0), 0);
        setAdminEmpleadoTotal(totalSaldo);
        
        if (empleadoRecords.length === 0) {
          setAdminSearchError("Sin registros anteriores - Puedes crear nuevos");
        }
      }
    } catch (err) {
      setAdminSearchError("Error al cargar datos");
    } finally {
      setAdminLoading(false);
    }
  };

  // Add record (admin mode)
  const handleAddRecord = async (e) => {
    e.preventDefault();
    setFormError("");
    setSuccessMessage("");

    if (!newRecord.week || (!newRecord.hours && !newRecord.minutes)) {
      setFormError("Semana y al menos horas o minutos son requeridos");
      return;
    }

    const hours = parseInt(newRecord.hours) || 0;
    const minutes = parseInt(newRecord.minutes) || 0;

    try {
      const response = await axios.post(`${API_BASE}/txt/admin/add`, {
        num_empleado,
        password,
        empleado: adminEmpleado,
        week: parseInt(newRecord.week),
        hours,
        minutes,
        comentarios: newRecord.comentarios || null
      });

      if (response.data.success) {
        setSuccessMessage(response.data.message);
        setNewRecord({ week: "", hours: "", minutes: "", comentarios: "" });
        await handleSearchEmpleado();
        setTimeout(() => setSuccessMessage(""), 3000);
      }
    } catch (err) {
      setFormError(err.response?.data?.error || "Error al guardar");
    }
  };

  // Add usage (admin mode)
  const handleAddUso = async (e) => {
    e.preventDefault();
    setFormError("");
    setSuccessMessage("");

    if (!newRecord.week || (!newRecord.hours && !newRecord.minutes)) {
      setFormError("Semana y al menos horas o minutos son requeridos");
      return;
    }

    const hours = parseInt(newRecord.hours) || 0;
    const minutes = parseInt(newRecord.minutes) || 0;

    try {
      const response = await axios.post(`${API_BASE}/txt/admin/add-uso`, {
        num_empleado,
        password,
        empleado: adminEmpleado,
        week: parseInt(newRecord.week),
        hours,
        minutes
      });

      if (response.data.success) {
        setSuccessMessage(response.data.message);
        setNewRecord({ week: "", hours: "", minutes: "" });
        await handleSearchEmpleado();
        setTimeout(() => setSuccessMessage(""), 3000);
      }
    } catch (err) {
      setFormError(err.response?.data?.error || "Error al guardar uso");
    }
  };

  // Delete record (admin mode)
  const handleDeleteRecord = async (recordId) => {
    if (!confirm("¿Estás seguro de que quieres eliminar este registro?")) {
      return;
    }

    try {
      const response = await axios.post(`${API_BASE}/txt/admin/delete`, {
        num_empleado,
        password,
        recordId
      });

      if (response.data.success) {
        setSuccessMessage("Registro eliminado");
        await handleSearchEmpleado();
        setTimeout(() => setSuccessMessage(""), 3000);
      }
    } catch (err) {
      setFormError(err.response?.data?.error || "Error al eliminar");
    }
  };

  // Save comment (admin mode)
  const handleSaveComment = async (recordId) => {
    setFormError("");
    setSuccessMessage("");

    try {
      const response = await axios.post(`${API_BASE}/txt/admin/comment`, {
        num_empleado,
        password,
        recordId,
        comentarios: commentText
      });

      if (response.data.success) {
        setSuccessMessage("Comentario guardado");
        setEditingCommentId(null);
        setCommentText("");
        await handleSearchEmpleado();
        setTimeout(() => setSuccessMessage(""), 3000);
      }
    } catch (err) {
      setFormError(err.response?.data?.error || "Error al guardar comentario");
    }
  };

  // Logout handler
  const handleLogout = () => {
    setIsAuthenticated(false);
    setMode(null);
    setCurrentUser(null);
    setNumEmpleado("");
    setPassword("");
    setRecords([]);
    setTotalMinutes(0);
    setTotalUsadas(0);
    setSaldoMinutes(0);
    setAllRecords([]);
    setViewerGrouped({});
    setAdminEmpleado("");
    setAdminEmpleadoData([]);
    setAdminEmpleadoTotal(0);
    setNewRecord({ week: "", hours: "", minutes: "", comentarios: "" });
    setEditingCommentId(null);
    setCommentText("");
    setAuthError("");
    setFormError("");
    setSuccessMessage("");
    setAdminSearchError("");
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-950 border border-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {!isAuthenticated ? (
          // Login form
          <div className="p-8">
            <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-6">
              <h2 className="text-3xl font-light">TXT - Horas Extra</h2>
              <button
                onClick={onClose}
                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-md transition"
              >
                Cerrar
              </button>
            </div>

            <div className="bg-gray-900 border border-gray-800 p-8 rounded-lg">
              <h3 className="text-2xl font-light mb-8">Autenticarse</h3>
              {authError && (
                <div className="mb-6 border-l-2 border-red-800 bg-gray-900 text-red-400 p-4">
                  {authError}
                </div>
              )}
              <form onSubmit={handleLogin} className="space-y-6">
                <div>
                  <label className="block text-lg font-medium mb-2 text-gray-300">
                    Usuario / Número Empleado
                  </label>
                  <input
                    type="text"
                    value={num_empleado}
                    onChange={(e) => setNumEmpleado(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md p-4 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-lg"
                    placeholder="Ingresa usuario o número de empleado"
                  />
                </div>
                <div>
                  <label className="block text-lg font-medium mb-2 text-gray-300">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md p-4 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-lg"
                    placeholder="Ingresa contraseña"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold py-4 rounded-md text-lg transition"
                >
                  ENTRAR
                </button>
              </form>
            </div>
          </div>
        ) : mode === "edit" ? (
          // Admin mode
          <div className="p-8">
            <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-6">
              <div>
                <h2 className="text-3xl font-light">TXT - Modo Edición</h2>
                <p className="text-gray-500 text-sm mt-2">
                  Administrador: {currentUser?.nombre}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-md transition"
              >
                Salir
              </button>
            </div>

            {/* Search employee */}
            <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg mb-8">
              <h3 className="text-xl font-light mb-6">Buscar Empleado</h3>
              {adminSearchError && (
                <div className={`mb-4 border-l-2 ${adminEmpleadoData.length > 0 ? 'border-blue-800 bg-gray-800 text-blue-400' : 'border-orange-800 bg-gray-800 text-orange-400'} p-3 text-sm`}>
                  {adminSearchError}
                </div>
              )}
              <div className="flex gap-3">
                <input
                  type="text"
                  value={adminEmpleado}
                  onChange={(e) => setAdminEmpleado(e.target.value)}
                  placeholder="Número de empleado"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-md p-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                  onKeyPress={(e) => e.key === 'Enter' && handleSearchEmpleado()}
                />
                <button
                  onClick={handleSearchEmpleado}
                  disabled={adminLoading}
                  className="bg-gray-800 hover:bg-gray-700 text-white font-semibold px-6 py-3 rounded-md transition disabled:opacity-50"
                >
                  {adminLoading ? "Cargando..." : "Buscar"}
                </button>
              </div>
            </div>

            {/* Add/Edit record */}
            {adminEmpleado && (
              <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg mb-8">
                <h3 className="text-xl font-light mb-6">Registro para {empleadoNames[adminEmpleado] ? `${empleadoNames[adminEmpleado]} (${adminEmpleado})` : adminEmpleado}</h3>
                {formError && (
                  <div className="mb-4 border-l-2 border-red-800 bg-gray-800 text-red-400 p-3 text-sm">
                    {formError}
                  </div>
                )}
                {successMessage && (
                  <div className="mb-4 border-l-2 border-emerald-800 bg-gray-800 text-emerald-400 p-3 text-sm">
                    {successMessage}
                  </div>
                )}
                <form className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <input
                      type="number"
                      value={newRecord.week}
                      onChange={(e) =>
                        setNewRecord({ ...newRecord, week: e.target.value })
                      }
                      placeholder="Semana"
                      className="col-span-2 bg-gray-800 border border-gray-700 rounded-md p-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                    />
                    <input
                      type="number"
                      value={newRecord.hours}
                      onChange={(e) =>
                        setNewRecord({ ...newRecord, hours: e.target.value })
                      }
                      placeholder="Horas"
                      className="bg-gray-800 border border-gray-700 rounded-md p-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                    />
                    <input
                      type="number"
                      value={newRecord.minutes}
                      onChange={(e) =>
                        setNewRecord({ ...newRecord, minutes: e.target.value })
                      }
                      placeholder="Min"
                      max="59"
                      className="bg-gray-800 border border-gray-700 rounded-md p-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                    />
                  </div>
                  <textarea
                    value={newRecord.comentarios}
                    onChange={(e) =>
                      setNewRecord({ ...newRecord, comentarios: e.target.value })
                    }
                    placeholder="Comentario (opcional, máx 250 caracteres)"
                    maxLength="250"
                    className="w-full bg-gray-800 border border-gray-700 rounded-md p-3 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
                    rows="2"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={handleAddRecord}
                      className="bg-emerald-900 hover:bg-emerald-800 text-emerald-200 font-semibold py-3 rounded-md transition"
                    >
                      Guardar Registro
                    </button>
                    <button
                      type="button"
                      onClick={handleAddUso}
                      className="bg-orange-900 hover:bg-orange-800 text-orange-200 font-semibold py-3 rounded-md transition"
                    >
                      Guardar Uso
                    </button>
                  </div>
                </form>

                {/* Current records for this employee */}
                {adminEmpleadoData.length > 0 && (
                  <div className="mt-8 pt-8 border-t border-gray-800">
                  <div className="flex justify-between items-center mb-4">
                      <h4 className="text-lg font-light text-gray-200">
                        Registros de {empleadoNames[adminEmpleado] ? `${empleadoNames[adminEmpleado]} (${adminEmpleado})` : adminEmpleado}
                      </h4>
                      <div className="space-y-1 text-right">
                        <div className="text-lg font-semibold" style={{color: adminEmpleadoTotal >= 0 ? '#10b981' : '#ef4444'}}>
                          Total saldo: {adminEmpleadoTotal < 0 ? '-' : ''}{Math.floor(Math.abs(adminEmpleadoTotal) / 60)}h {Math.abs(adminEmpleadoTotal) % 60}m
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {adminEmpleadoData.map((record) => {
                        const { hours, minutes } = minutesToTime(record.hours);
                        const usedHours = Math.floor((record.usadas || 0) / 60);
                        const usedMinutes = (record.usadas || 0) % 60;
                        const saldoTotal = record.hours - (record.usadas || 0);
                        const saldoIsNegative = saldoTotal < 0;
                        const absSaldoTotal = Math.abs(saldoTotal);
                        const saldoHours = Math.floor(absSaldoTotal / 60);
                        const saldoMinutes = absSaldoTotal % 60;
                        
                        return (
                          <div
                            key={record.id}
                            className="flex justify-between items-start bg-gray-800 p-4 rounded border border-gray-700 hover:border-gray-600 transition gap-4"
                          >
                            <div className="flex-1">
                              <p className="text-gray-300 font-semibold">Semana {record.week}</p>
                              <p className="text-gray-500 text-sm mt-2">
                                Generados: {hours}h {minutes}m | Gastados: {usedHours}h {usedMinutes}m
                              </p>
                              <p className={`text-sm font-semibold ${saldoIsNegative ? 'text-red-400' : 'text-emerald-400'}`}>
                                Saldo: {saldoIsNegative ? '-' : ''}{saldoHours}h {saldoMinutes}m
                              </p>
                              
                              {/* Comment display/edit */}
                              <div className="mt-3 pt-3 border-t border-gray-700">
                                {editingCommentId === record.id ? (
                                  <div className="space-y-2">
                                    <textarea
                                      value={commentText}
                                      onChange={(e) => setCommentText(e.target.value)}
                                      placeholder="Agregar comentario..."
                                      maxLength="250"
                                      className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-gray-500 resize-none"
                                      rows="3"
                                    />
                                    <div className="flex gap-2 text-xs">
                                      <button
                                        type="button"
                                        onClick={() => handleSaveComment(record.id)}
                                        className="bg-emerald-900 hover:bg-emerald-800 text-emerald-200 px-3 py-1 rounded transition"
                                      >
                                        Guardar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCommentId(null);
                                          setCommentText("");
                                        }}
                                        className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded transition"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    {record.comentarios ? (
                                      <div className="bg-gray-700 p-2 rounded text-sm text-gray-200 mb-2">
                                        <p className="text-gray-400 text-xs font-semibold mb-1">Comentario:</p>
                                        <p>{record.comentarios}</p>
                                      </div>
                                    ) : (
                                      <p className="text-gray-500 text-sm italic">Sin comentario</p>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingCommentId(record.id);
                                        setCommentText(record.comentarios || "");
                                      }}
                                      className="text-blue-400 hover:text-blue-300 text-xs mt-1 transition"
                                    >
                                      Editar comentario
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteRecord(record.id)}
                              className="bg-red-900 hover:bg-red-800 text-red-200 px-4 py-2 rounded transition whitespace-nowrap"
                            >
                              Eliminar
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : mode === "viewer" ? (
          // Viewer mode - see all employees
          <div className="p-8">
            <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-6">
              <div>
                <h2 className="text-3xl font-light">TXT - Visualización General</h2>
                <p className="text-gray-500 text-sm mt-2">
                  {currentUser?.nombre}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-md transition"
              >
                Salir
              </button>
            </div>

            {/* All employees records */}
            {allRecords.length > 0 ? (
              <div className="space-y-6">
                {Object.keys(viewerGrouped).map((empleado) => {
                  const empleadoRecords = viewerGrouped[empleado];
                  const totalEmpleadoMinutes = empleadoRecords.reduce((sum, r) => sum + (r.hours || 0), 0);
                  const totalEmpleadoUsadas = empleadoRecords.reduce((sum, r) => sum + (r.usadas || 0), 0);
                  const totalEmpleadoSaldo = totalEmpleadoMinutes - totalEmpleadoUsadas;
                  const saldoIsNegative = totalEmpleadoSaldo < 0;
                  const absSaldo = Math.abs(totalEmpleadoSaldo);

                  return (
                    <div key={empleado} className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
                      <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-800">
                        <h3 className="text-xl font-light text-gray-200">
                          {empleadoNames[empleado] ? `${empleadoNames[empleado]} (${empleado})` : empleado}
                        </h3>
                        <div className="text-right space-y-1">
                          <div className="text-sm text-gray-500">Total Saldo</div>
                          <div className={`text-lg font-semibold ${saldoIsNegative ? 'text-red-400' : 'text-emerald-400'}`}>
                            {saldoIsNegative ? '-' : ''}{Math.floor(absSaldo / 60)}h {absSaldo % 60}m
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {empleadoRecords.map((record) => {
                          const { hours, minutes } = minutesToTime(record.hours);
                          const usedHours = Math.floor((record.usadas || 0) / 60);
                          const usedMinutes = (record.usadas || 0) % 60;
                          const saldoTotal = record.hours - (record.usadas || 0);
                          const saldoIsNeg = saldoTotal < 0;
                          const absSaldoTotal = Math.abs(saldoTotal);
                          const saldoHours = Math.floor(absSaldoTotal / 60);
                          const saldoMinutes = absSaldoTotal % 60;

                          return (
                            <div key={record.id} className="bg-gray-800 p-4 rounded border border-gray-700">
                              <div className="flex justify-between items-start mb-3">
                                <div className="font-semibold text-gray-300">Semana {record.week}</div>
                                <div className={`text-sm font-semibold ${saldoIsNeg ? 'text-red-400' : 'text-emerald-400'}`}>
                                  Saldo: {saldoIsNeg ? '-' : ''}{saldoHours}h {saldoMinutes}m
                                </div>
                              </div>
                              
                              <div className="text-sm text-gray-500 space-y-1 mb-3">
                                <p>Generados: <span className="text-white">{hours}h {minutes}m</span></p>
                                <p>Gastados: <span className="text-orange-400">{usedHours}h {usedMinutes}m</span></p>
                              </div>

                              {/* Display comment if exists */}
                              {record.comentarios && (
                                <div className="bg-gray-700 p-3 rounded border-l-2 border-blue-600">
                                  <p className="text-gray-400 text-xs font-semibold mb-1">Comentario:</p>
                                  <p className="text-gray-200 text-sm">{record.comentarios}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-gray-500 py-8">
                No hay registros de horas extra
              </div>
            )}
          </div>
        ) : (
          // User view mode
          <div className="p-8">
            <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-6">
              <div>
                <h2 className="text-3xl font-light">TXT - Mis Horas Extra</h2>
                <p className="text-gray-500 text-sm mt-2">
                  {currentUser?.nombre} <span className="text-gray-600">({currentUser?.num_empleado})</span>
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-md transition"
              >
                Salir
              </button>
            </div>

            {/* Summary */}
            <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg mb-8">
              <div className="text-center space-y-4">
                <div>
                  <p className="text-gray-500 text-sm uppercase tracking-widest mb-2">
                    Horas Generadas
                  </p>
                  <p className="text-4xl font-bold text-white">
                    {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m
                  </p>
                </div>
                <div className="border-t border-gray-700 pt-4">
                  <p className="text-gray-500 text-sm uppercase tracking-widest mb-2">
                    Horas Gastadas
                  </p>
                  <p className="text-3xl font-semibold text-orange-400">
                    {Math.floor(totalUsadas / 60)}h {totalUsadas % 60}m
                  </p>
                </div>
                <div className="border-t border-gray-700 pt-4">
                  <p className="text-gray-500 text-sm uppercase tracking-widest mb-2">
                    Saldo
                  </p>
                  <p className={`text-3xl font-bold ${saldoMinutes >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {saldoMinutes < 0 ? '-' : ''}{Math.floor(Math.abs(saldoMinutes) / 60)}h {Math.abs(saldoMinutes) % 60}m
                  </p>
                </div>
              </div>
            </div>

            {/* Records table */}
            {records.length > 0 ? (
              <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg">
                <h3 className="text-xl font-light mb-6 text-gray-200">Registro de Horas</h3>
                <div className="space-y-2">
                  {records.map((record) => {
                    const { hours: h, minutes: m } = minutesToTime(record.hours);
                    const usedH = Math.floor((record.usadas || 0) / 60);
                    const usedM = (record.usadas || 0) % 60;
                    const saldoTotal = record.hours - (record.usadas || 0);
                    const saldoIsNegative = saldoTotal < 0;
                    const absurdoTotal = Math.abs(saldoTotal);
                    const saldoH = Math.floor(absurdoTotal / 60);
                    const saldoM = absurdoTotal % 60;
                    
                    return (
                      <div
                        key={record.id}
                        className="bg-gray-800 p-4 rounded border border-gray-700"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="text-gray-300 font-semibold">Semana {record.week}</p>
                            <div className="text-sm text-gray-500 mt-2 space-y-1">
                              <p>Generados: <span className="text-white">{h}h {m}m</span></p>
                              <p>Gastados: <span className="text-orange-400">{usedH}h {usedM}m</span></p>
                              <p>Saldo: <span className={`font-semibold ${saldoIsNegative ? 'text-red-400' : 'text-emerald-400'}`}>{saldoIsNegative ? '-' : ''}{saldoH}h {saldoM}m</span></p>
                            </div>
                            
                            {/* Display comment if exists */}
                            {record.comentarios && (
                              <div className="mt-3 pt-3 border-t border-gray-700">
                                <p className="text-gray-400 text-xs font-semibold mb-1">Comentario:</p>
                                <p className="text-gray-300 text-sm">{record.comentarios}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-8">
                No tienes registros de horas extra
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TxtComponent;
