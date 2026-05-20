const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');
const bcryptjs = require('bcryptjs');
require('dotenv').config();
const { asistenciaPool, credencialesPool } = require('./db');
const adminConfig = require('./admin-config');

const app = express();

// Comprehensive CORS configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Explicit CORS headers middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

app.use(express.json());

// Gaveta configuration
const GAVETAS_COUNT = 2;
const POSITIONS_PER_GAVETA = 36;
const TOTAL_POSITIONS = GAVETAS_COUNT * POSITIONS_PER_GAVETA; // 72 total

// Helper: Check if current time is within allowed windows
// Allowed: 6:50-10:00 AM and 6:50-10:00 PM
function isWithinAccessWindow() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  
  // Morning window: 6:50 (410) to 10:00 (600)
  const morningStart = 6 * 60 + 50;  // 410 minutes
  const morningEnd = 10 * 60 + 0;    // 600 minutes
  
  // Evening window: 18:50 (1130) to 10:00 PM (1320)
  const eveningStart = 18 * 60 + 50; // 1130 minutes
  const eveningEnd = 22 * 60 + 0;    // 1320 minutes
  
  return (totalMinutes >= morningStart && totalMinutes <= morningEnd) ||
         (totalMinutes >= eveningStart && totalMinutes <= eveningEnd);
}

// Helper: Get current turn (1 = morning, 2 = evening)
// Morning: 7:00 AM - 1:59 PM
// Evening: 2:00 PM - 11:59 PM
function getCurrentTurn() {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 14 ? 1 : 2;
}

// Helper: Get current turn display name
function getCurrentTurnName() {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 14 ? 'TURNO MAÑANA' : 'TURNO TARDE';
}

// Helper: Calculate next gaveta and posicion for current turn today
async function getNextGavetaPosicion(turn, today) {
  // Count how many scans exist for this turn today (these already have positions assigned)
  const [rows] = await asistenciaPool.query(
    'SELECT COUNT(*) as count FROM assistance_logs WHERE DATE(scan_time) = ? AND turn = ?',
    [today, turn]
  );
  
  const currentCount = rows[0].count;
  
  // If all positions are filled, cycle back
  const slotIndex = currentCount % TOTAL_POSITIONS;
  
  // Calculate gaveta (1-based) and posicion (1-based)
  const gaveta = Math.floor(slotIndex / POSITIONS_PER_GAVETA) + 1;
  const posicion = (slotIndex % POSITIONS_PER_GAVETA) + 1;
  
  return { gaveta, posicion };
}

// Init DB
async function initDB() {
  let initialized = false;
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DB Init Attempt ${attempt}/${maxRetries}] Starting...`);
      
      // Create tables in asistencia database
      const asistConn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'asistencia'
      });
      
      await asistConn.query(`
        CREATE TABLE IF NOT EXISTS assistance_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          num_empleado VARCHAR(255) NOT NULL,
          full_name VARCHAR(255) NOT NULL,
          area VARCHAR(255),
          turn INT DEFAULT 1,
          gaveta INT DEFAULT NULL,
          posicion INT DEFAULT NULL,
          scan_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_num_empleado (num_empleado),
          INDEX idx_scan_time (scan_time),
          INDEX idx_turn (turn),
          INDEX idx_daily_scan (num_empleado, scan_time, turn)
        )
      `);
      console.log('[DB Init] assistance_logs table created/verified');
      
      // Add gaveta and posicion columns if they don't exist (migration for existing tables)
      try {
        await asistConn.query('ALTER TABLE assistance_logs ADD COLUMN gaveta INT DEFAULT NULL AFTER turn');
        console.log('[DB Init] Added gaveta column');
      } catch (e) {
        // Column already exists, ignore
        if (!e.message.includes('Duplicate column')) {
          console.log('[DB Init] gaveta column already exists');
        }
      }
      
      try {
        await asistConn.query('ALTER TABLE assistance_logs ADD COLUMN posicion INT DEFAULT NULL AFTER gaveta');
        console.log('[DB Init] Added posicion column');
      } catch (e) {
        // Column already exists, ignore
        if (!e.message.includes('Duplicate column')) {
          console.log('[DB Init] posicion column already exists');
        }
      }
      
      await asistConn.end();
      
      initialized = true;
      console.log('[DB Init] Database initialization completed successfully');
      break;
    } catch (error) {
      console.error(`[DB Init Attempt ${attempt}/${maxRetries}] Error:`, error.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  
  if (!initialized) {
    console.error('[DB Init] Failed to initialize database after all retries');
  }
}

initDB();

// Normalize employee number
function normalizeEmployeeNumber(input) {
  if (!input) return '';
  const str = String(input).toUpperCase().trim();
  const noLeadingZeros = str.replace(/^0+([0-9])/, '$1');
  return noLeadingZeros || str;
}

// Generate search variants
function generateSearchVariants(input) {
  const normalized = normalizeEmployeeNumber(input);
  const variants = [
    normalized,
    normalized.replace(/[A-Z]$/, ''),
    normalized + 'A',
  ];
  variants.push(input);
  variants.push(input.replace(/[A-Z]$/, ''));
  variants.push(input + 'A');
  
  return [...new Set(variants)].filter(v => v);
}

function sortByAreaThenTime(logs) {
  return [...logs].sort((a, b) => {
    const areaA = (a.area || '').toString();
    const areaB = (b.area || '').toString();
    const areaCmp = areaA.localeCompare(areaB, 'es', { sensitivity: 'base' });
    if (areaCmp !== 0) return areaCmp;
    return new Date(a.scan_time) - new Date(b.scan_time);
  });
}

async function enrichLogsWithCredenciales(logs) {
  if (!logs.length) return logs;

  const employeeIds = [...new Set(logs.map(l => l.num_empleado).filter(Boolean))];
  const placeholders = employeeIds.map(() => '?').join(',');

  const [credUsers] = await credencialesPool.query(
    `SELECT num_empleado, usuario, rol, area FROM users WHERE num_empleado IN (${placeholders})`,
    employeeIds
  );

  const byNum = new Map();
  const byNormalizedNum = new Map();
  const byUsuario = new Map();

  for (const u of credUsers) {
    if (u.num_empleado) {
      byNum.set(u.num_empleado, u);
      byNormalizedNum.set(normalizeEmployeeNumber(u.num_empleado), u);
    }
    if (u.usuario) {
      byUsuario.set(String(u.usuario), u);
    }
  }

  return logs.map(log => {
    const direct = byNum.get(log.num_empleado);
    const normalized = byNormalizedNum.get(normalizeEmployeeNumber(log.num_empleado));
    const byUser = byUsuario.get(String(log.num_empleado));
    const found = direct || normalized || byUser;

    return {
      ...log,
      rol: found?.rol || null,
      area: found?.area || null
    };
  });
}

// Get current server time and turn - for frontend synchronization
app.get('/api/time/current', (req, res) => {
  const now = new Date();
  const turn = getCurrentTurn();
  const turnName = getCurrentTurnName();
  const withinWindow = isWithinAccessWindow();
  
  res.json({
    timestamp: now.getTime(),
    time: now.toLocaleTimeString(),
    turn,
    turnName,
    withinWindow,
    hours: now.getHours(),
    minutes: now.getMinutes(),
    seconds: now.getSeconds()
  });
});

// Auth endpoint - Verify credentials for accessing reports
app.post('/api/auth', async (req, res) => {
  const { usuario, password } = req.body;
  
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    // Generate search variants (handles 258, 0258, 258A, 0258A, etc.)
    const variants = generateSearchVariants(usuario);
    const placeholders = variants.map(() => 'num_empleado = ?').join(' OR ');
    const query = `SELECT id, nombre, rol, pass_hash FROM users WHERE ${placeholders} LIMIT 1`;
    
    // Query credenciales DB for user
    const [users] = await credencialesPool.query(query, variants);

    if (users.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = users[0];
    
    // Ensure pass_hash is a string
    let passHash = user.pass_hash;
    if (typeof passHash !== 'string') {
      passHash = String(passHash);
    }
    
    // Verify password using bcryptjs
    const isPasswordValid = await bcryptjs.compare(password, passHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        nombre: user.nombre,
        rol: user.rol
      }
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Attendance endpoint (primary route avoids common blocker keywords)
const handleAttendanceLog = async (req, res) => {
  const { num_empleado } = req.body;
  
  // Check time window
  if (!isWithinAccessWindow()) {
    return res.status(403).json({ 
      error: 'Acceso fuera del horario permitido. Permitido: 7:50-10:00 AM y 7:50-10:00 PM' 
    });
  }

  if (!num_empleado) {
    return res.status(400).json({ error: 'Número de empleado es requerido' });
  }

  try {
    // Verify pool connections are available
    if (!credencialesPool || !asistenciaPool) {
      throw new Error('Database pools not initialized');
    }

    const variants = generateSearchVariants(num_empleado);
    const placeholders = variants.map(() => 'num_empleado = ?').join(' OR ');
    const query = `SELECT num_empleado, nombre, rol, area FROM users WHERE ${placeholders} OR usuario IN (${variants.map(() => '?').join(',')}) LIMIT 1`;
    
    const params = [...variants, ...variants];
    let connection;
    try {
      connection = await credencialesPool.getConnection();
      const [users] = await connection.query(query, params);
      connection.release();

      if (users.length === 0) {
        return res.status(404).json({ 
          error: 'Empleado no encontrado',
          searched: num_empleado 
        });
      }

      const unumber = users[0].num_empleado || num_empleado;
      const name = users[0].nombre || 'Desconocido';
      const rol = users[0].rol || null;
      const area = users[0].area || null;
      const turn = getCurrentTurn();
      const today = new Date().toISOString().split('T')[0];

      // Check if already scanned for this turn today
      try {
        connection = await asistenciaPool.getConnection();
        const [existing] = await connection.query(
          'SELECT id FROM assistance_logs WHERE num_empleado = ? AND DATE(scan_time) = ? AND turn = ? LIMIT 1',
          [unumber, today, turn]
        );
        
        if (existing.length > 0) {
          connection.release();
          return res.status(409).json({ 
            error: 'Ya registraste asistencia en este turno hoy',
            user: { num_empleado: unumber, full_name: name }
          });
        }
        
        // Calculate next gaveta and posicion
        const { gaveta, posicion } = await getNextGavetaPosicion(turn, today);
        
        // Insert the new record with gaveta and posicion
        await connection.query(
          'INSERT INTO assistance_logs (num_empleado, full_name, area, turn, gaveta, posicion) VALUES (?, ?, ?, ?, ?, ?)',
          [unumber, name, area, turn, gaveta, posicion]
        );
        connection.release();

        console.log(`Success: Registered ${unumber} - ${name} for turn ${turn} | Gaveta ${gaveta}, Posición ${posicion}`);
        res.json({ 
          message: 'Asistencia registrada', 
          user: { 
            num_empleado: unumber, 
            full_name: name, 
            rol,
            area,
            turn: turn,
            gaveta,
            posicion,
            date: new Date() 
          }
        });
      } catch (insertError) {
        if (connection) connection.release();
        // Log any unexpected errors
        console.error('Insert error:', insertError);
        throw insertError;
      }
    } catch (poolError) {
      if (connection) connection.release();
      throw poolError;
    }
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ error: 'Error del servidor', details: error.message });
  }
};

app.post('/api/attendance/log', handleAttendanceLog);
// Backward compatibility
app.post('/api/scan', handleAttendanceLog);

// Get registrations for today per turn - requires authentication
app.post('/api/registrations/today', async (req, res) => {
  const { usuario, password, date } = req.body;
  
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    // Generate search variants (handles 258, 0258, 258A, 0258A, etc.)
    const variants = generateSearchVariants(usuario);
    const placeholders = variants.map(() => 'num_empleado = ?').join(' OR ');
    const query = `SELECT rol, area, pass_hash FROM users WHERE ${placeholders} LIMIT 1`;
    
    // Verify credentials - search by num_empleado variants
    const [users] = await credencialesPool.query(query, variants);

    if (users.length === 0) {
      console.log(`[Auth Failed] User not found with variants: ${variants.join(', ')}`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    // Ensure pass_hash is a string
    let passHash = users[0].pass_hash;
    if (typeof passHash !== 'string') {
      passHash = String(passHash);
    }
    
    const isPasswordValid = await bcryptjs.compare(password, passHash);
    if (!isPasswordValid) {
      console.log(`[Auth Failed] Invalid password for user: ${usuario}`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    console.log(`[Auth Success] User authenticated with variant: ${usuario}`);

    const userArea = users[0].area;
    const searchDate = date || new Date().toISOString().split('T')[0];
    
    // Query logs for the specified date, filtered by user's area
    const [rawLogs] = await asistenciaPool.query(
      'SELECT num_empleado, full_name, area, gaveta, posicion, scan_time FROM assistance_logs WHERE DATE(scan_time) = ? AND area = ? ORDER BY scan_time',
      [searchDate, userArea]
    );

    const logs = await enrichLogsWithCredenciales(rawLogs);
    
    // Add turn property based on time (since old table doesn't have turn column yet)
    const logsWithTurn = logs.map(log => {
      const hour = new Date(log.scan_time).getHours();
      const turn = hour >= 7 && hour < 14 ? 1 : 2;
      return { ...log, turn };
    });
    
    // Separate logs into turns based on time of day
    // Turn 1: Morning (6:00 - 13:59)
    // Turn 2: Afternoon (14:00 - 23:59)
    const turn1Logs = logsWithTurn.filter(log => {
      const hour = new Date(log.scan_time).getHours();
      return hour >= 6 && hour < 14;
    }).sort((a, b) => {
      const areaOrder = a.area?.localeCompare(b.area || '') || 0;
      if (areaOrder !== 0) return areaOrder;
      return new Date(a.scan_time) - new Date(b.scan_time);
    });

    const turn2Logs = logsWithTurn.filter(log => {
      const hour = new Date(log.scan_time).getHours();
      return hour >= 14 || hour < 6;
    }).sort((a, b) => {
      const areaOrder = a.area?.localeCompare(b.area || '') || 0;
      if (areaOrder !== 0) return areaOrder;
      return new Date(a.scan_time) - new Date(b.scan_time);
    });

    res.json({
      date: searchDate,
      userArea: userArea,
      turn_1: {
        time: '7:50 - 10:00 AM',
        data: turn1Logs,
        registrations: turn1Logs.length
      },
      turn_2: {
        time: '7:50 - 10:00 PM',
        data: turn2Logs,
        registrations: turn2Logs.length
      },
      total: logs.length
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener registros' });
  }
});

// Download registrations as Excel - requires authentication
app.post('/api/registrations/download', async (req, res) => {
  const { usuario, password, date, turn } = req.body;
  
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    // Generate search variants (handles 258, 0258, 258A, 0258A, etc.)
    const variants = generateSearchVariants(usuario);
    const placeholders = variants.map(() => 'num_empleado = ?').join(' OR ');
    const query = `SELECT area, pass_hash FROM users WHERE ${placeholders} LIMIT 1`;
    
    // Verify credentials
    const [users] = await credencialesPool.query(query, variants);

    if (users.length === 0) {
      console.log(`[Auth Failed] User not found for download with variants: ${variants.join(', ')}`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    // Ensure pass_hash is a string
    let passHash = users[0].pass_hash;
    if (typeof passHash !== 'string') {
      passHash = String(passHash);
    }
    
    const isPasswordValid = await bcryptjs.compare(password, passHash);
    if (!isPasswordValid) {
      console.log(`[Auth Failed] Invalid password for download user: ${usuario}`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const userArea = users[0].area;
    const searchDate = date || new Date().toISOString().split('T')[0];
    
    // Query all logs for the date and area
    const [rawLogsData] = await asistenciaPool.query(
      'SELECT num_empleado, full_name, area, gaveta, posicion, scan_time FROM assistance_logs WHERE DATE(scan_time) = ? AND area = ? ORDER BY scan_time',
      [searchDate, userArea]
    );

    let logs = await enrichLogsWithCredenciales(rawLogsData);
    
    // Filter by turn if specified (calculate turn based on time)
    if (turn && turn !== 'all') {
      const targetTurn = parseInt(turn);
      logs = logs.filter(log => {
        const hour = new Date(log.scan_time).getHours();
        const logTurn = hour >= 7 && hour < 14 ? 1 : 2;
        return logTurn === targetTurn;
      });
    }

    // Create Excel workbook
    const workbook = XLSX.utils.book_new();
    const worksheetData = [
      ['Area', 'Num Empleado', 'Nombre', 'Gaveta', 'Posición', 'Turno']
    ];

    logs.forEach(log => {
      const hour = new Date(log.scan_time).getHours();
      const turnNum = hour >= 7 && hour < 14 ? 1 : 2;
      const turnName = turnNum === 1 ? 'Mañana' : 'Tarde';
      worksheetData.push([
        log.area || '',
        log.num_empleado,
        log.full_name,
        log.gaveta || '',
        log.posicion || '',
        turnName
      ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Registros');

    // Set column widths
    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 15 },
      { wch: 25 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 }
    ];

    // Generate Excel file as buffer
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="asistencia-${searchDate}.xlsx"`);
    res.send(excelBuffer);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Error al descargar registros' });
  }
});

// TXT FEATURE ENDPOINTS
// Admin endpoint - Get all TXT records (edit mode)
app.post('/api/txt/admin/auth', async (req, res) => {
  const { num_empleado, password } = req.body;
  
  if (!num_empleado || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    // Check admin credentials from config
    const isValidAdmin = num_empleado === adminConfig.adminUser.num_empleado && 
                        password === adminConfig.adminUser.password;
    
    if (!isValidAdmin) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json({
      success: true,
      user: {
        num_empleado: adminConfig.adminUser.num_empleado,
        nombre: adminConfig.adminUser.nombre,
        rol: 'admin'
      }
    });
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Get all TXT records (admin only)
app.post('/api/txt/admin/records', async (req, res) => {
  const { num_empleado, password } = req.body;
  
  if (!num_empleado || !password) {
    return res.status(400).json({ error: 'Autenticación requerida' });
  }

  try {
    // Verify admin credentials
    const isValidAdmin = num_empleado === adminConfig.adminUser.num_empleado && 
                        password === adminConfig.adminUser.password;
    
    if (!isValidAdmin) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Query all txt records
    const [records] = await asistenciaPool.query(
      'SELECT * FROM txt ORDER BY empleado, week DESC'
    );

    // Group records by empleado
    const grouped = {};
    records.forEach(record => {
      if (!grouped[record.empleado]) {
        grouped[record.empleado] = [];
      }
      grouped[record.empleado].push(record);
    });

    res.json({
      success: true,
      records: records,
      grouped: grouped
    });
  } catch (error) {
    console.error('Error fetching txt records:', error);
    res.status(500).json({ error: 'Error al obtener registros' });
  }
});

// Add or update TXT record - HOURS GENERATED (admin only)
app.post('/api/txt/admin/add', async (req, res) => {
  const { num_empleado, password, empleado, week, hours, minutes } = req.body;
  
  if (!num_empleado || !password) {
    return res.status(400).json({ error: 'Autenticación requerida' });
  }

  if (!empleado || !week || (hours === undefined && minutes === undefined)) {
    return res.status(400).json({ error: 'Empleado, semana y horas/minutos son requeridos' });
  }

  try {
    // Verify admin credentials
    const isValidAdmin = num_empleado === adminConfig.adminUser.num_empleado && 
                        password === adminConfig.adminUser.password;
    
    if (!isValidAdmin) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Convert hours and minutes to total minutes
    const totalMinutes = (parseInt(hours) || 0) * 60 + (parseInt(minutes) || 0);

    if (totalMinutes === 0) {
      return res.status(400).json({ error: 'Debe ingresar al menos algunos minutos' });
    }

    // Check if record exists
    const [existing] = await asistenciaPool.query(
      'SELECT id, hours FROM txt WHERE empleado = ? AND week = ?',
      [empleado, week]
    );

    if (existing.length > 0) {
      // Update existing record - SUM the minutes
      const currentMinutes = existing[0].hours;
      const updatedMinutes = currentMinutes + totalMinutes;
      
      await asistenciaPool.query(
        'UPDATE txt SET hours = ? WHERE empleado = ? AND week = ?',
        [updatedMinutes, empleado, week]
      );
      
      res.json({
        success: true,
        message: `Registro actualizado - Total: ${totalMinutes} minutos sumados`
      });
    } else {
      // Insert new record
      await asistenciaPool.query(
        'INSERT INTO txt (empleado, week, hours, usadas) VALUES (?, ?, ?, 0)',
        [empleado, week, totalMinutes]
      );
      
      res.json({
        success: true,
        message: 'Registro añadido'
      });
    }
  } catch (error) {
    console.error('Error adding txt record:', error);
    res.status(500).json({ error: 'Error al guardar registro' });
  }
});

// Add or update TXT record - HOURS USED (admin only)
app.post('/api/txt/admin/add-uso', async (req, res) => {
  const { num_empleado, password, empleado, week, hours, minutes } = req.body;
  
  if (!num_empleado || !password) {
    return res.status(400).json({ error: 'Autenticación requerida' });
  }

  if (!empleado || !week || (hours === undefined && minutes === undefined)) {
    return res.status(400).json({ error: 'Empleado, semana y horas/minutos son requeridos' });
  }

  try {
    // Verify admin credentials
    const isValidAdmin = num_empleado === adminConfig.adminUser.num_empleado && 
                        password === adminConfig.adminUser.password;
    
    if (!isValidAdmin) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Convert hours and minutes to total minutes
    const totalMinutes = (parseInt(hours) || 0) * 60 + (parseInt(minutes) || 0);

    if (totalMinutes === 0) {
      return res.status(400).json({ error: 'Debe ingresar al menos algunos minutos' });
    }

    // Check if record exists
    const [existing] = await asistenciaPool.query(
      'SELECT id, hours, usadas FROM txt WHERE empleado = ? AND week = ?',
      [empleado, week]
    );

    if (existing.length === 0) {
      // Create new record with 0 hours generated and the usage
      await asistenciaPool.query(
        'INSERT INTO txt (empleado, week, hours, usadas) VALUES (?, ?, ?, ?)',
        [empleado, week, 0, totalMinutes]
      );
    } else {
      // Update existing record - SUM the used minutes (only update usadas)
      const currentUsed = existing[0].usadas || 0;
      const updatedUsed = currentUsed + totalMinutes;
      
      await asistenciaPool.query(
        'UPDATE txt SET usadas = ? WHERE empleado = ? AND week = ?',
        [updatedUsed, empleado, week]
      );
    }
    
    res.json({
      success: true,
      message: `Uso registrado - Total: ${totalMinutes} minutos sumados`
    });
  } catch (error) {
    console.error('Error adding txt usage:', error);
    res.status(500).json({ error: 'Error al guardar uso' });
  }
});

// Get TXT records for viewing (regular user)
app.post('/api/txt/view', async (req, res) => {
  const { num_empleado, pass_hash } = req.body;
  
  if (!num_empleado || !pass_hash) {
    return res.status(400).json({ error: 'Empleado y contraseña requeridos' });
  }

  try {
    // Verify user credentials in credenciales DB
    const variants = generateSearchVariants(num_empleado);
    const placeholders = variants.map(() => 'num_empleado = ?').join(' OR ');
    const query = `SELECT pass_hash FROM users WHERE ${placeholders} LIMIT 1`;
    
    const [users] = await credencialesPool.query(query, variants);

    if (users.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verify password
    let passHashStored = users[0].pass_hash;
    if (typeof passHashStored !== 'string') {
      passHashStored = String(passHashStored);
    }
    
    const isPasswordValid = await bcryptjs.compare(pass_hash, passHashStored);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Get txt records for this empleado
    const [records] = await asistenciaPool.query(
      'SELECT * FROM txt WHERE empleado = ? ORDER BY week DESC',
      [num_empleado]
    );

    // Calculate totals (generados - gastados)
    let totalMinutes = 0;
    let totalUsadas = 0;
    records.forEach(record => {
      totalMinutes += record.hours || 0;
      totalUsadas += record.usadas || 0;
    });
    
    const saldoMinutes = totalMinutes - totalUsadas;

    res.json({
      success: true,
      empleado: num_empleado,
      records: records,
      totalMinutes: totalMinutes,
      totalUsadas: totalUsadas,
      saldoMinutes: saldoMinutes
    });
  } catch (error) {
    console.error('Error fetching user txt records:', error);
    res.status(500).json({ error: 'Error al obtener registros' });
  }
});

// Delete TXT record (admin only)
app.post('/api/txt/admin/delete', async (req, res) => {
  const { num_empleado, password, recordId } = req.body;
  
  if (!num_empleado || !password || !recordId) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  try {
    // Verify admin credentials
    const isValidAdmin = num_empleado === adminConfig.adminUser.num_empleado && 
                        password === adminConfig.adminUser.password;
    
    if (!isValidAdmin) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    await asistenciaPool.query('DELETE FROM txt WHERE id = ?', [recordId]);

    res.json({
      success: true,
      message: 'Registro eliminado'
    });
  } catch (error) {
    console.error('Error deleting txt record:', error);
    res.status(500).json({ error: 'Error al eliminar registro' });
  }
});

const PORT = process.env.PORT || 3113;

// Start server after a small delay to ensure DB init completes
setTimeout(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}, 1000);
