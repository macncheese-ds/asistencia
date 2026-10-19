const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');
const bcryptjs = require('bcryptjs');
require('dotenv').config();
const { asistenciaPool, credencialesPool } = require('./db');
const crypto = require('crypto');

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

// Scan configuration defaults (engineer 179 can change them). Window values are minutes since midnight.
const DEFAULT_ESCANEO_CONFIG = {
  dias_minimos_entre_escaneos: 1,
  escaneos_aviso_guantes: 3,
  ventana_manana_inicio_min: 6 * 60 + 50,  // 6:50
  ventana_manana_fin_min: 10 * 60,         // 10:00
  ventana_tarde_inicio_min: 18 * 60 + 50,  // 18:50
  ventana_tarde_fin_min: 22 * 60,          // 22:00
  aviso_duracion_seg: 5
};

// Hora de Saltillo, Coahuila (UTC-6 todo el año). Los campos de la hora de pared se leen con getUTC*.
const SALTILLO_OFFSET_MS = -6 * 60 * 60 * 1000;
function wallClockSaltillo(date = new Date()) {
  return new Date(new Date(date).getTime() + SALTILLO_OFFSET_MS);
}

// Helper: Check if current time is within the configured morning or evening window (inclusive)
function isWithinAccessWindow(cfg = DEFAULT_ESCANEO_CONFIG) {
  const wall = wallClockSaltillo();
  const totalMinutes = wall.getUTCHours() * 60 + wall.getUTCMinutes();

  return (totalMinutes >= Number(cfg.ventana_manana_inicio_min) && totalMinutes <= Number(cfg.ventana_manana_fin_min)) ||
         (totalMinutes >= Number(cfg.ventana_tarde_inicio_min) && totalMinutes <= Number(cfg.ventana_tarde_fin_min));
}

function formatMinutesOfDay(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Helper: Get current turn (1 = morning, 2 = evening)
// Morning: 7:00 AM - 1:59 PM
// Evening: 2:00 PM - 11:59 PM
function getCurrentTurn() {
  const hour = wallClockSaltillo().getUTCHours();
  return hour >= 7 && hour < 14 ? 1 : 2;
}

// Helper: Get current turn display name
function getCurrentTurnName() {
  const hour = wallClockSaltillo().getUTCHours();
  return hour >= 7 && hour < 14 ? 'TURNO MAÑANA' : 'TURNO TARDE';
}

// Helper: Calculate next gaveta and posicion for current turn today
async function getNextGavetaPosicion(turn, today, db = asistenciaPool) {
  // Count how many scans exist for this turn today (these already have positions assigned)
  const [rows] = await db.query(
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
      

      // Scan interval / glove threshold config and hour requests (same DDL as migrations/001_solicitudes_horas_intervalo_guantes.sql)
      const newSchemaStatements = [
        `CREATE TABLE IF NOT EXISTS escaneo_configuracion (
          id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
          dias_minimos_entre_escaneos INT NOT NULL DEFAULT 1,
          escaneos_aviso_guantes INT NOT NULL DEFAULT 3,
          ventana_manana_inicio_min INT NOT NULL DEFAULT 410,
          ventana_manana_fin_min INT NOT NULL DEFAULT 600,
          ventana_tarde_inicio_min INT NOT NULL DEFAULT 1130,
          ventana_tarde_fin_min INT NOT NULL DEFAULT 1320,
          aviso_duracion_seg INT NOT NULL DEFAULT 5,
          updated_by_num VARCHAR(50) NULL,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT chk_dias_minimos CHECK (dias_minimos_entre_escaneos BETWEEN 0 AND 30),
          CONSTRAINT chk_escaneos_guantes CHECK (escaneos_aviso_guantes BETWEEN 1 AND 30)
        )`,
        `INSERT IGNORE INTO escaneo_configuracion (id, dias_minimos_entre_escaneos, escaneos_aviso_guantes) VALUES (1, 1, 3)`,
        `CREATE TABLE IF NOT EXISTS escaneo_configuracion_historial (
          id INT AUTO_INCREMENT PRIMARY KEY,
          campo VARCHAR(64) NOT NULL,
          valor_anterior INT NULL,
          valor_nuevo INT NOT NULL,
          usuario_num_empleado VARCHAR(50) NOT NULL,
          usuario_id INT NULL,
          changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_config_historial_changed_at (changed_at)
        )`,
        `CREATE TABLE IF NOT EXISTS empleado_contador_guantes (
          num_empleado VARCHAR(50) NOT NULL PRIMARY KEY,
          escaneos INT NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS solicitudes_horas (
          id INT AUTO_INCREMENT PRIMARY KEY,
          empleado_num VARCHAR(50) NOT NULL,
          empleado_nombre VARCHAR(100) NULL,
          fecha DATE NOT NULL,
          minutos INT NOT NULL,
          estado ENUM('pendiente', 'autorizada', 'denegada') NOT NULL DEFAULT 'pendiente',
          request_token VARCHAR(64) NOT NULL,
          capturado_por_id INT NULL,
          capturado_por_num VARCHAR(50) NOT NULL,
          capturado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resuelto_por_id INT NULL,
          resuelto_por_num VARCHAR(50) NULL,
          resuelto_at DATETIME NULL,
          UNIQUE KEY uq_solicitudes_request_token (request_token),
          INDEX idx_solicitudes_empleado_fecha (empleado_num, fecha),
          INDEX idx_solicitudes_estado_fecha (estado, fecha),
          CONSTRAINT chk_solicitud_minutos CHECK (minutos BETWEEN 1 AND 1440)
        )`
      ];
      for (const statement of newSchemaStatements) {
        await asistConn.query(statement);
      }
      // Columns added after the first release of escaneo_configuracion (existing installs)
      const configColumnAlters = [
        'ADD COLUMN ventana_manana_inicio_min INT NOT NULL DEFAULT 410',
        'ADD COLUMN ventana_manana_fin_min INT NOT NULL DEFAULT 600',
        'ADD COLUMN ventana_tarde_inicio_min INT NOT NULL DEFAULT 1130',
        'ADD COLUMN ventana_tarde_fin_min INT NOT NULL DEFAULT 1320',
        'ADD COLUMN aviso_duracion_seg INT NOT NULL DEFAULT 5'
      ];
      for (const alter of configColumnAlters) {
        try {
          await asistConn.query(`ALTER TABLE escaneo_configuracion ${alter}`);
        } catch (e) {
          if (!e.message.includes('Duplicate column')) throw e;
        }
      }
      console.log('[DB Init] Scan config and hour request tables created/verified');

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
app.get('/api/time/current', async (req, res) => {
  const now = new Date();
  const turn = getCurrentTurn();
  const turnName = getCurrentTurnName();
  let cfg = DEFAULT_ESCANEO_CONFIG;
  try {
    cfg = await getEscaneoConfig();
  } catch (error) {
    console.error('Error reading scan config for time endpoint:', error.message);
  }
  const withinWindow = isWithinAccessWindow(cfg);
  
  res.json({
    timestamp: now.getTime(),
    time: now.toLocaleTimeString(undefined, { timeZone: 'America/Mexico_City' }),
    turn,
    turnName,
    withinWindow,
    aviso_duracion_seg: Number(cfg.aviso_duracion_seg),
    hours: wallClockSaltillo(now).getUTCHours(),
    minutes: wallClockSaltillo(now).getUTCMinutes(),
    seconds: wallClockSaltillo(now).getUTCSeconds()
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

// Shift starts: turn 1 at 07:00, turn 2 at 14:00 (same boundaries as getCurrentTurn)
const SHIFT_START_MORNING = 7;
const SHIFT_START_EVENING = 14;

// Start of the shift a scan belongs to. 00:00-06:59 belongs to the evening shift that began the previous day.
function getShiftAnchor(scanDate) {
  const wall = wallClockSaltillo(scanDate);
  const hour = wall.getUTCHours();
  const dayStart = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  let anchorWall;
  if (hour >= SHIFT_START_MORNING && hour < SHIFT_START_EVENING) {
    anchorWall = dayStart + SHIFT_START_MORNING * 3600000;
  } else if (hour >= SHIFT_START_EVENING) {
    anchorWall = dayStart + SHIFT_START_EVENING * 3600000;
  } else {
    anchorWall = dayStart - 86400000 + SHIFT_START_EVENING * 3600000;
  }
  return new Date(anchorWall - SALTILLO_OFFSET_MS);
}

// Next allowed scan: start of the last valid shift + N calendar days, same shift start time
function getNextAllowedScan(lastScanDate, diasMinimos) {
  const next = getShiftAnchor(lastScanDate);
  return new Date(next.getTime() + diasMinimos * 86400000);
}

function formatDateTimeEs(date) {
  const wall = wallClockSaltillo(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(wall.getUTCDate())}/${pad(wall.getUTCMonth() + 1)}/${wall.getUTCFullYear()} ${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

async function getEscaneoConfig(db = asistenciaPool) {
  const [rows] = await db.query(
    `SELECT dias_minimos_entre_escaneos, escaneos_aviso_guantes,
            ventana_manana_inicio_min, ventana_manana_fin_min,
            ventana_tarde_inicio_min, ventana_tarde_fin_min,
            aviso_duracion_seg, updated_by_num, updated_at
       FROM escaneo_configuracion WHERE id = 1`
  );
  return rows[0] || { ...DEFAULT_ESCANEO_CONFIG, updated_by_num: null, updated_at: null };
}

const handleAttendanceLog = async (req, res) => {
  const { num_empleado } = req.body;
  
  // Check time window (configurable by engineer 179)
  let windowConfig;
  try {
    windowConfig = await getEscaneoConfig();
  } catch (error) {
    console.error('Error reading scan config:', error);
    return res.status(500).json({ error: 'Error al leer la configuración de escaneo' });
  }
  if (!isWithinAccessWindow(windowConfig)) {
    const manana = `${formatMinutesOfDay(Number(windowConfig.ventana_manana_inicio_min))}-${formatMinutesOfDay(Number(windowConfig.ventana_manana_fin_min))}`;
    const tarde = `${formatMinutesOfDay(Number(windowConfig.ventana_tarde_inicio_min))}-${formatMinutesOfDay(Number(windowConfig.ventana_tarde_fin_min))}`;
    return res.status(403).json({ 
      error: `Acceso fuera del horario permitido. Permitido: ${manana} y ${tarde}` 
    });
  }

  if (!num_empleado) {
    return res.status(400).json({ error: 'Número de empleado es requerido' });
  }

  let connection;
  try {
    // Verify pool connections are available
    if (!credencialesPool || !asistenciaPool) {
      throw new Error('Database pools not initialized');
    }

    const variants = generateSearchVariants(num_empleado);
    const placeholders = variants.map(() => 'num_empleado = ?').join(' OR ');
    const query = `SELECT num_empleado, nombre, rol, area FROM users WHERE ${placeholders} OR usuario IN (${variants.map(() => '?').join(',')}) LIMIT 1`;
    const [users] = await credencialesPool.query(query, [...variants, ...variants]);

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
    const today = todayDateOnly();
    const employee = { num_empleado: unumber, full_name: name, rol, area };

    connection = await asistenciaPool.getConnection();
    await connection.beginTransaction();

    // Locks the employee's glove counter row, serializing valid scans for this employee
    await connection.query(
      'INSERT IGNORE INTO empleado_contador_guantes (num_empleado, escaneos) VALUES (?, 0)',
      [unumber]
    );
    const [counterRows] = await connection.query(
      'SELECT escaneos FROM empleado_contador_guantes WHERE num_empleado = ? FOR UPDATE',
      [unumber]
    );

    const config = await getEscaneoConfig(connection);
    const now = new Date();

    // Minimum interval, measured from the employee's last valid scan (0 disables it)
    if (config.dias_minimos_entre_escaneos > 0) {
      const [lastRows] = await connection.query(
        'SELECT MAX(scan_time) AS last_scan FROM assistance_logs WHERE num_empleado = ?',
        [unumber]
      );
      if (lastRows[0].last_scan) {
        const nextAllowed = getNextAllowedScan(new Date(lastRows[0].last_scan), config.dias_minimos_entre_escaneos);
        if (now < nextAllowed) {
          await connection.rollback();
          return res.status(409).json({
            code: 'INTERVALO_PENDIENTE',
            error: `Aún no puedes realizar un nuevo registro. Próxima fecha permitida: ${formatDateTimeEs(nextAllowed)}`,
            proxima_fecha_permitida: nextAllowed.toISOString(),
            proxima_fecha_texto: formatDateTimeEs(nextAllowed),
            user: employee
          });
        }
      }
    }

    // Check if already scanned for this turn today
    const [existing] = await connection.query(
      'SELECT id FROM assistance_logs WHERE num_empleado = ? AND DATE(scan_time) = ? AND turn = ? LIMIT 1',
      [unumber, today, turn]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(409).json({ 
        error: 'Ya registraste asistencia en este turno hoy',
        user: { num_empleado: unumber, full_name: name }
      });
    }

    // Calculate next gaveta and posicion
    const { gaveta, posicion } = await getNextGavetaPosicion(turn, today, connection);

    await connection.query(
      'INSERT INTO assistance_logs (num_empleado, full_name, area, turn, gaveta, posicion) VALUES (?, ?, ?, ?, ?, ?)',
      [unumber, name, area, turn, gaveta, posicion]
    );

    // Only valid scans increment the counter; reaching the threshold fires the warning and resets it to 0
    const umbral = config.escaneos_aviso_guantes;
    let escaneos = (counterRows[0]?.escaneos ?? 0) + 1;
    const avisoGuantes = escaneos >= umbral;
    if (avisoGuantes) {
      await connection.query(
        'INSERT INTO avisos_guantes (empleado_num, fecha, escaneos_umbral, avisado_at) VALUES (?, ?, ?, ?)',
        [unumber, todayDateOnly(), umbral, now]
      );
      escaneos = 0;
    }
    await connection.query(
      'UPDATE empleado_contador_guantes SET escaneos = ? WHERE num_empleado = ?',
      [escaneos, unumber]
    );

    await connection.commit();

    console.log(`Success: Registered ${unumber} - ${name} for turn ${turn} | Gaveta ${gaveta}, Posición ${posicion}${avisoGuantes ? ' | AVISO GUANTES' : ''}`);
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
      },
      aviso_guantes: avisoGuantes,
      contador_guantes: escaneos,
      umbral_guantes: umbral
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Scan error:', error);
    res.status(500).json({ error: 'Error del servidor', details: error.message });
  } finally {
    if (connection) connection.release();
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
    const searchDate = date || todayDateOnly();
    
    // Query logs for the specified date, filtered by user's area
    const [rawLogs] = await asistenciaPool.query(
      'SELECT num_empleado, full_name, area, gaveta, posicion, scan_time FROM assistance_logs WHERE DATE(scan_time) = ? AND area = ? ORDER BY scan_time',
      [searchDate, userArea]
    );

    const logs = await enrichLogsWithCredenciales(rawLogs);
    
    // Add turn property based on time (since old table doesn't have turn column yet)
    const logsWithTurn = logs.map(log => {
      const hour = wallClockSaltillo(log.scan_time).getUTCHours();
      const turn = hour >= 7 && hour < 14 ? 1 : 2;
      return { ...log, turn };
    });
    
    // Separate logs into turns based on time of day
    // Turn 1: Morning (6:00 - 13:59)
    // Turn 2: Afternoon (14:00 - 23:59)
    const turn1Logs = logsWithTurn.filter(log => {
      const hour = wallClockSaltillo(log.scan_time).getUTCHours();
      return hour >= 6 && hour < 14;
    }).sort((a, b) => {
      const areaOrder = a.area?.localeCompare(b.area || '') || 0;
      if (areaOrder !== 0) return areaOrder;
      return new Date(a.scan_time) - new Date(b.scan_time);
    });

    const turn2Logs = logsWithTurn.filter(log => {
      const hour = wallClockSaltillo(log.scan_time).getUTCHours();
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
    const searchDate = date || todayDateOnly();
    
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
        const hour = wallClockSaltillo(log.scan_time).getUTCHours();
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
      const hour = wallClockSaltillo(log.scan_time).getUTCHours();
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

// TXT / SOLICITUDES DE HORAS
// Sessions are opaque tokens kept on the server. Passwords are only checked against credenciales.users.
// Identity of the authorizing engineer: credenciales.users.num_empleado = '179' (rol Ingeniero).
const AUTHORIZER_NUM_EMPLEADO = '179';
const TXT_ALLOWED_ROLES = ['Ingeniero', 'Tool Room'];
const TXT_ESTADOS = ['pendiente', 'autorizada', 'denegada'];
const TXT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const txtSessions = new Map();

function isAuthorizerUser(user) {
  return Boolean(user) && txtEmployeeCore(user.num_empleado) === AUTHORIZER_NUM_EMPLEADO && user.rol === 'Ingeniero';
}

function getBearerToken(req) {
  const header = req.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function requireTxtAuth({ authorizerOnly = false, toolRoomOnly = false, authorizerOrToolRoom = false } = {}) {
  return (req, res, next) => {
    const token = getBearerToken(req);
    const session = token ? txtSessions.get(token) : null;
    if (!session || session.expiresAt < Date.now()) {
      if (session) txtSessions.delete(token);
      return res.status(401).json({ error: 'Sesión no válida o expirada. Inicia sesión nuevamente.' });
    }
    const allowed = authorizerOnly
      ? isAuthorizerUser(session.user)
      : toolRoomOnly
        ? session.user.rol === 'Tool Room'
        : authorizerOrToolRoom
          ? isAuthorizerUser(session.user) || session.user.rol === 'Tool Room'
          : TXT_ALLOWED_ROLES.includes(session.user.rol);
    if (!allowed) {
      return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
    }
    req.txtUser = session.user;
    next();
  };
}

function parseIntField(value, min, max) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

// Strips leading zeros and the optional trailing letter: "000179A" -> "179"
function txtEmployeeCore(value) {
  const str = String(value ?? '').trim().toUpperCase().replace(/[A-Z]$/, '');
  return str.replace(/^0+(?=\d)/, '');
}

// Input is matched without caring about zeros or trailing "A": 179, 0179, 179a, 000179A
function txtEmployeeVariants(value) {
  const core = txtEmployeeCore(value);
  return core ? [core, `${core}A`] : [];
}

function normalizeTxtEmployeeNumber(value) {
  return txtEmployeeCore(value);
}

async function findTxtUser(value, columns) {
  const variants = txtEmployeeVariants(value);
  if (!variants.length) return null;
  const [rows] = await credencialesPool.query(
    `SELECT ${columns} FROM users WHERE num_empleado IN (${variants.map(() => '?').join(',')}) LIMIT 1`,
    variants
  );
  return rows[0] || null;
}

function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function todayDateOnly() {
  return wallClockSaltillo().toISOString().slice(0, 10);
}

const SOLICITUD_SELECT = `
  SELECT s.id, s.empleado_num, s.empleado_nombre,
    DATE_FORMAT(s.fecha, '%Y-%m-%d') AS fecha,
    DATE_FORMAT(DATE_SUB(s.fecha, INTERVAL WEEKDAY(s.fecha) DAY), '%Y-%m-%d') AS semana_inicio,
    s.minutos, s.estado,
    s.capturado_por_num, s.capturado_at,
    s.resuelto_por_num, s.resuelto_at
  FROM solicitudes_horas s`;

async function enrichSolicitudes(rows) {
  if (!rows.length) return rows;
  const nums = [...new Set(rows.map((r) => r.empleado_num))];
  const [users] = await credencialesPool.query(
    `SELECT num_empleado, nombre FROM users WHERE num_empleado IN (${nums.map(() => '?').join(',')})`,
    nums
  );
  const byNum = new Map(users.map((u) => [u.num_empleado, u]));
  return rows.map((r) => ({
    ...r,
    empleado_nombre: byNum.get(r.empleado_num)?.nombre || r.empleado_nombre
  }));
}

async function getSolicitudById(id) {
  const [rows] = await asistenciaPool.query(`${SOLICITUD_SELECT} WHERE s.id = ?`, [id]);
  if (!rows.length) return null;
  const [solicitud] = await enrichSolicitudes(rows);
  return solicitud;
}

// Login: validates credenciales.users, allows only Ingeniero and Tool Room, returns an opaque session token
app.post('/api/txt/login', async (req, res) => {
  const numEmpleado = normalizeTxtEmployeeNumber(req.body?.num_empleado);
  const password = req.body?.password;

  if (!numEmpleado || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Número de empleado y contraseña requeridos' });
  }

  try {
    const found = await findTxtUser(numEmpleado, 'id, nombre, num_empleado, rol, pass_hash');
    const users = found ? [found] : [];

    if (users.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const passHash = String(users[0].pass_hash);
    const isPasswordValid = await bcryptjs.compare(password, passHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!TXT_ALLOWED_ROLES.includes(users[0].rol)) {
      return res.status(403).json({ error: 'Tu rol no tiene acceso a este módulo.' });
    }

    const user = {
      id: users[0].id,
      num_empleado: users[0].num_empleado,
      nombre: users[0].nombre,
      rol: users[0].rol
    };
    const token = crypto.randomBytes(32).toString('hex');
    txtSessions.set(token, { user, expiresAt: Date.now() + TXT_SESSION_TTL_MS });

    res.json({ success: true, token, user, can_authorize: isAuthorizerUser(user) });
  } catch (error) {
    console.error('TXT login error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/txt/logout', (req, res) => {
  const token = getBearerToken(req);
  if (token) txtSessions.delete(token);
  res.json({ success: true });
});

app.get('/api/txt/empleados/:num', requireTxtAuth(), async (req, res) => {
  const empleadoNum = normalizeTxtEmployeeNumber(req.params.num);
  if (!empleadoNum) {
    return res.status(400).json({ error: 'Número de empleado requerido' });
  }
  try {
    const found = await findTxtUser(empleadoNum, 'num_empleado, nombre, area');
    const users = found ? [found] : [];
    if (users.length === 0) {
      return res.status(404).json({ error: 'Empleado no encontrado', searched: empleadoNum });
    }
    res.json({ empleado: { num_empleado: users[0].num_empleado, nombre: users[0].nombre, area: users[0].area } });
  } catch (error) {
    console.error('TXT employee lookup error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Captures an hours request (status pendiente). Hours are never added to the total here.
app.post('/api/txt/solicitudes', requireTxtAuth(), async (req, res) => {
  const { num_empleado, fecha, horas, minutos, request_token } = req.body || {};
  const token = String(request_token ?? '').trim();
  const empleadoNum = normalizeTxtEmployeeNumber(num_empleado);
  const h = parseIntField(horas, 0, 24);
  const m = parseIntField(minutos, 0, 59);
  const minutosTotales = h === null || m === null ? null : h * 60 + m;

  if (!/^[A-Za-z0-9-]{16,64}$/.test(token)) {
    return res.status(400).json({ error: 'Identificador de solicitud no válido.' });
  }
  if (!empleadoNum) {
    return res.status(400).json({ error: 'Número de empleado requerido.' });
  }
  if (!isValidDateOnly(fecha)) {
    return res.status(400).json({ error: 'Fecha no válida. Usa el formato AAAA-MM-DD.' });
  }
  if (minutosTotales === null || minutosTotales < 1 || minutosTotales > 1440) {
    return res.status(400).json({ error: 'La cantidad debe ser mayor a 0 y no exceder 24 horas (minutos entre 0 y 59).' });
  }

  try {
    const foundEmp = await findTxtUser(empleadoNum, 'num_empleado, nombre');
    const empleados = foundEmp ? [foundEmp] : [];
    if (empleados.length === 0) {
      return res.status(404).json({ error: 'Empleado no encontrado', searched: empleadoNum });
    }

    const capturador = req.txtUser;
    try {
      const [result] = await asistenciaPool.query(
        `INSERT INTO solicitudes_horas
          (empleado_num, empleado_nombre, fecha, minutos, estado, request_token, capturado_por_id, capturado_por_num)
         VALUES (?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
        [empleados[0].num_empleado, empleados[0].nombre, fecha, minutosTotales, token, capturador.id, capturador.num_empleado]
      );
      const solicitud = await getSolicitudById(result.insertId);
      return res.status(201).json({ message: 'Solicitud registrada. Queda pendiente de autorización.', solicitud });
    } catch (insertError) {
      if (insertError.code !== 'ER_DUP_ENTRY') throw insertError;
      // Retry of the same submission: return the existing request instead of creating a duplicate
      const [rows] = await asistenciaPool.query(
        'SELECT id, capturado_por_id FROM solicitudes_horas WHERE request_token = ? LIMIT 1',
        [token]
      );
      if (rows.length === 0 || rows[0].capturado_por_id !== capturador.id) {
        return res.status(409).json({ error: 'Identificador de solicitud ya utilizado.' });
      }
      const solicitud = await getSolicitudById(rows[0].id);
      return res.status(200).json({ message: 'Solicitud ya registrada. No se duplicó.', duplicate: true, solicitud });
    }
  } catch (error) {
    console.error('Error creating solicitud:', error);
    res.status(500).json({ error: 'Error al registrar la solicitud' });
  }
});

// History and pending list (engineer 179 only). Filters: estado, num_empleado, fecha, semana (any date of the week, Monday-Sunday).
app.get('/api/txt/solicitudes', requireTxtAuth({ authorizerOnly: true }), async (req, res) => {
  const { estado, num_empleado, fecha, semana } = req.query;
  const where = [];
  const params = [];

  if (estado !== undefined && estado !== '') {
    if (!TXT_ESTADOS.includes(estado)) {
      return res.status(400).json({ error: 'Estado no válido.' });
    }
    where.push('s.estado = ?');
    params.push(estado);
  }
  if (num_empleado) {
    const variants = txtEmployeeVariants(num_empleado);
    where.push(`s.empleado_num IN (${variants.map(() => '?').join(',') || "''"})`);
    params.push(...variants);
  }
  if (fecha) {
    if (!isValidDateOnly(fecha)) {
      return res.status(400).json({ error: 'Fecha no válida. Usa el formato AAAA-MM-DD.' });
    }
    where.push('s.fecha = ?');
    params.push(fecha);
  }
  if (semana) {
    if (!isValidDateOnly(semana)) {
      return res.status(400).json({ error: 'Semana no válida. Usa el formato AAAA-MM-DD.' });
    }
    where.push('s.fecha >= DATE_SUB(?, INTERVAL WEEKDAY(?) DAY) AND s.fecha < DATE_ADD(DATE_SUB(?, INTERVAL WEEKDAY(?) DAY), INTERVAL 7 DAY)');
    params.push(semana, semana, semana, semana);
  }

  try {
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [rows] = await asistenciaPool.query(
      `${SOLICITUD_SELECT}${whereSql} ORDER BY s.fecha DESC, s.id DESC LIMIT 500`,
      params
    );
    res.json({ solicitudes: await enrichSolicitudes(rows) });
  } catch (error) {
    console.error('Error listing solicitudes:', error);
    res.status(500).json({ error: 'Error al consultar solicitudes' });
  }
});

// Authorize or deny (engineer 179 only). The UPDATE only matches pending rows, so a request is resolved once.
app.post('/api/txt/solicitudes/:id/resolver', requireTxtAuth({ authorizerOnly: true }), async (req, res) => {
  const id = parseIntField(req.params.id, 1, 2147483647);
  const accion = req.body?.accion;
  const nuevoEstado = accion === 'autorizar' ? 'autorizada' : accion === 'denegar' ? 'denegada' : null;

  if (id === null) {
    return res.status(400).json({ error: 'Identificador de solicitud no válido.' });
  }
  if (!nuevoEstado) {
    return res.status(400).json({ error: 'Acción no válida. Usa "autorizar" o "denegar".' });
  }

  try {
    const [result] = await asistenciaPool.query(
      `UPDATE solicitudes_horas
         SET estado = ?, resuelto_por_id = ?, resuelto_por_num = ?, resuelto_at = CURRENT_TIMESTAMP
       WHERE id = ? AND estado = 'pendiente'`,
      [nuevoEstado, req.txtUser.id, req.txtUser.num_empleado, id]
    );

    if (result.affectedRows === 0) {
      const [rows] = await asistenciaPool.query('SELECT estado FROM solicitudes_horas WHERE id = ?', [id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Solicitud no encontrada.' });
      }
      return res.status(409).json({ error: `La solicitud ya fue ${rows[0].estado}. No se puede resolver de nuevo.` });
    }

    const solicitud = await getSolicitudById(id);
    res.json({
      message: nuevoEstado === 'autorizada' ? 'Solicitud autorizada.' : 'Solicitud denegada.',
      solicitud
    });
  } catch (error) {
    console.error('Error resolving solicitud:', error);
    res.status(500).json({ error: 'Error al resolver la solicitud' });
  }
});

// Legacy txt.empleado may be stored as 179, 0179, 179A, 000179A... This reduces it to the same core used by the employee lookup.
const TXT_EMPLEADO_CORE_SQL = `TRIM(LEADING '0' FROM IF(RIGHT(UPPER(TRIM(empleado)), 1) = 'A',
      LEFT(UPPER(TRIM(empleado)), CHAR_LENGTH(TRIM(empleado)) - 1),
      UPPER(TRIM(empleado))))`;

// Balance per employee. Authorized total = legacy txt hours + authorized requests - hours used (Tool Room). Pending and denied are never added.
async function calcularTotalesEmpleado(dbNum) {
  const [historico] = await asistenciaPool.query(
    `SELECT COALESCE(SUM(hours), 0) AS horas, COALESCE(SUM(usadas), 0) AS usadas FROM txt WHERE ${TXT_EMPLEADO_CORE_SQL} = ?`,
    [txtEmployeeCore(dbNum)]
  );
  const [semanas] = await asistenciaPool.query(
    `SELECT DATE_FORMAT(DATE_SUB(fecha, INTERVAL WEEKDAY(fecha) DAY), '%Y-%m-%d') AS semana_inicio,
       COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN minutos ELSE 0 END), 0) AS pendiente_min,
       COALESCE(SUM(CASE WHEN estado = 'autorizada' THEN minutos ELSE 0 END), 0) AS autorizada_min,
       COALESCE(SUM(CASE WHEN estado = 'denegada' THEN minutos ELSE 0 END), 0) AS denegada_min
     FROM solicitudes_horas
     WHERE empleado_num = ?
     GROUP BY semana_inicio
     ORDER BY semana_inicio DESC`,
    [dbNum]
  );
  const [utilizadas] = await asistenciaPool.query(
    'SELECT COALESCE(SUM(minutos), 0) AS utilizado_min FROM horas_utilizadas WHERE empleado_num = ?',
    [dbNum]
  );

  const semanasNorm = semanas.map((s) => ({
    semana_inicio: s.semana_inicio,
    pendiente_min: Number(s.pendiente_min),
    autorizada_min: Number(s.autorizada_min),
    denegada_min: Number(s.denegada_min)
  }));
  const suma = (campo) => semanasNorm.reduce((acc, s) => acc + s[campo], 0);
  const horasHistoricas = Number(historico[0].horas);
  const usadasHistoricas = Number(historico[0].usadas);
  const saldoHistorico = horasHistoricas - usadasHistoricas;
  const utilizadoMin = Number(utilizadas[0].utilizado_min);
  const totalGeneradoMin = horasHistoricas + suma('autorizada_min');
  const totalGastadoMin = usadasHistoricas + utilizadoMin;

  return {
    historico: { horas_min: horasHistoricas, usadas_min: usadasHistoricas, saldo_min: saldoHistorico },
    utilizado_min: utilizadoMin,
    total_generado_min: totalGeneradoMin,
    total_gastado_min: totalGastadoMin,
    total_autorizado_min: totalGeneradoMin - totalGastadoMin,
    pendiente_min: suma('pendiente_min'),
    denegada_min: suma('denegada_min'),
    semanas: semanasNorm
  };
}

app.get('/api/txt/totales/:num', requireTxtAuth(), async (req, res) => {
  const empleadoNum = normalizeTxtEmployeeNumber(req.params.num);
  try {
    const found = await findTxtUser(empleadoNum, 'num_empleado, nombre, area');
    const empleados = found ? [found] : [];
    if (empleados.length === 0) {
      return res.status(404).json({ error: 'Empleado no encontrado', searched: empleadoNum });
    }
    const totales = await calcularTotalesEmpleado(empleados[0].num_empleado);
    res.json({
      empleado: { num_empleado: empleados[0].num_empleado, nombre: empleados[0].nombre, area: empleados[0].area },
      ...totales
    });
  } catch (error) {
    console.error('Error computing totals:', error);
    res.status(500).json({ error: 'Error al calcular totales' });
  }
});

// Tool Room only: records hours already used by an employee. No request or authorization step; the available balance drops immediately.
app.post('/api/txt/horas-utilizadas', requireTxtAuth({ toolRoomOnly: true }), async (req, res) => {
  const { num_empleado, fecha, horas, minutos, request_token } = req.body || {};
  const token = String(request_token ?? '').trim();
  const empleadoNum = normalizeTxtEmployeeNumber(num_empleado);
  const h = parseIntField(horas, 0, 24);
  const m = parseIntField(minutos, 0, 59);
  const minutosTotales = h === null || m === null ? null : h * 60 + m;

  if (!/^[A-Za-z0-9-]{16,64}$/.test(token)) {
    return res.status(400).json({ error: 'Identificador de registro no válido.' });
  }
  if (!empleadoNum) {
    return res.status(400).json({ error: 'Número de empleado requerido.' });
  }
  if (!isValidDateOnly(fecha)) {
    return res.status(400).json({ error: 'Fecha no válida. Usa el formato AAAA-MM-DD.' });
  }
  if (minutosTotales === null || minutosTotales < 1 || minutosTotales > 1440) {
    return res.status(400).json({ error: 'La cantidad debe ser mayor a 0 y no exceder 24 horas.' });
  }

  let conn = null;
  let lockName = null;
  try {
    const found = await findTxtUser(empleadoNum, 'num_empleado, nombre');
    if (!found) {
      return res.status(404).json({ error: 'Empleado no encontrado', searched: empleadoNum });
    }
    const dbNum = found.num_empleado;

    // A named lock per employee keeps two Tool Room users from spending the same balance at once
    conn = await asistenciaPool.getConnection();
    lockName = `txt_horas_${dbNum}`;
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 10) AS ok', [lockName]);
    if (Number(lock.ok) !== 1) {
      lockName = null;
      return res.status(409).json({ error: 'Este empleado está siendo actualizado. Intenta de nuevo.' });
    }

    const [existing] = await asistenciaPool.query(
      'SELECT empleado_num, registrado_por_id FROM horas_utilizadas WHERE request_token = ? LIMIT 1',
      [token]
    );
    if (existing.length) {
      if (existing[0].empleado_num !== dbNum || existing[0].registrado_por_id !== req.txtUser.id) {
        return res.status(409).json({ error: 'Identificador de registro ya utilizado.' });
      }
      const totales = await calcularTotalesEmpleado(dbNum);
      return res.status(200).json({ message: 'Este registro ya estaba guardado. No se duplicó.', duplicate: true, totales });
    }

    const totales = await calcularTotalesEmpleado(dbNum);
    if (minutosTotales > totales.total_autorizado_min) {
      return res.status(409).json({
        error: 'No hay horas disponibles suficientes para registrar esa cantidad.',
        disponible_min: totales.total_autorizado_min
      });
    }

    await asistenciaPool.query(
      `INSERT INTO horas_utilizadas (empleado_num, fecha, minutos, request_token, registrado_por_id, registrado_por_num)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [dbNum, fecha, minutosTotales, token, req.txtUser.id, req.txtUser.num_empleado]
    );
    const actualizados = await calcularTotalesEmpleado(dbNum);
    res.status(201).json({ message: 'Horas utilizadas registradas. El disponible se redujo.', duplicate: false, totales: actualizados });
  } catch (error) {
    console.error('Error registering used hours:', error);
    res.status(500).json({ error: 'Error al registrar las horas utilizadas' });
  } finally {
    if (conn) {
      if (lockName) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
      conn.release();
    }
  }
});


// Historial por empleado de TXT: horas agregadas (solicitudes), horas utilizadas y registros legacy de txt.
const HISTORIAL_TIPOS = ['agregada', 'utilizada', 'legacy'];
const HISTORIAL_LIMITE = 500;

app.get('/api/txt/historial', requireTxtAuth({ authorizerOrToolRoom: true }), async (req, res) => {
  const { tipo, num_empleado } = req.query;
  if (tipo !== undefined && tipo !== '' && !HISTORIAL_TIPOS.includes(tipo)) {
    return res.status(400).json({ error: 'Tipo no válido.' });
  }
  if (!num_empleado || !normalizeTxtEmployeeNumber(num_empleado)) {
    return res.status(400).json({ error: 'Indica el número de empleado para ver su historial.' });
  }
  const variants = txtEmployeeVariants(num_empleado);
  const filtroEmpleado = (columna) =>
    variants.length ? ` AND ${columna} IN (${variants.map(() => '?').join(',')})` : '';
  const params = variants;
  const incluir = (t) => !tipo || tipo === t;
  const numCore = txtEmployeeCore(num_empleado);

  try {
    const registros = [];
    if (incluir('agregada')) {
      const [rows] = await asistenciaPool.query(
        `SELECT 'agregada' AS tipo, id, empleado_num, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, minutos, estado,
           capturado_por_num AS registrado_por_num, capturado_at AS registrado_at, NULL AS escaneos_umbral
         FROM solicitudes_horas WHERE 1=1${filtroEmpleado('empleado_num')}
         ORDER BY capturado_at DESC LIMIT ${HISTORIAL_LIMITE}`,
        params
      );
      registros.push(...rows);
    }
    if (incluir('utilizada')) {
      const [rows] = await asistenciaPool.query(
        `SELECT 'utilizada' AS tipo, id, empleado_num, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, minutos, NULL AS estado,
           registrado_por_num, registrado_at, NULL AS escaneos_umbral
         FROM horas_utilizadas WHERE 1=1${filtroEmpleado('empleado_num')}
         ORDER BY registrado_at DESC LIMIT ${HISTORIAL_LIMITE}`,
        params
      );
      registros.push(...rows);
    }
    if (incluir('legacy')) {
      // txt has no event date, so these rows carry no fecha/registrado_at and sort last.
      const [rows] = await asistenciaPool.query(
        `SELECT 'legacy' AS tipo, id, ${TXT_EMPLEADO_CORE_SQL} AS empleado_num, NULL AS fecha, hours AS minutos, NULL AS estado,
           NULL AS registrado_por_num, NULL AS registrado_at, NULL AS escaneos_umbral,
           usadas AS usadas_min, week AS semana, comentarios
         FROM txt WHERE ${TXT_EMPLEADO_CORE_SQL} = ?
         ORDER BY week DESC LIMIT ${HISTORIAL_LIMITE}`,
        [numCore]
      );
      registros.push(...rows);
    }

    const limitados = registros
      .sort((a, b) => new Date(b.registrado_at) - new Date(a.registrado_at))
      .slice(0, HISTORIAL_LIMITE);

    const nums = [...new Set(limitados.map((r) => r.empleado_num))];
    const nombres = new Map();
    if (nums.length) {
      const [users] = await credencialesPool.query(
        `SELECT num_empleado, nombre FROM users WHERE num_empleado IN (${nums.map(() => '?').join(',')})`,
        nums
      );
      users.forEach((u) => nombres.set(u.num_empleado, u.nombre));
    }

    res.json({
      registros: limitados.map((r) => ({ ...r, empleado_nombre: nombres.get(r.empleado_num) || '' }))
    });
  } catch (error) {
    console.error('Error reading hours history:', error);
    res.status(500).json({ error: 'Error al consultar el historial' });
  }
});

// Registro de avisos de cambio de guantes de todos los empleados. Sin contraseña.
async function consultarAvisosGuantes() {
  const [avisos] = await asistenciaPool.query(
    `SELECT id, empleado_num, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, escaneos_umbral, avisado_at,
            DATE_FORMAT(avisado_at, '%Y-%m-%d %H:%i:%s') AS avisado_texto
     FROM avisos_guantes ORDER BY avisado_at DESC`
  );

  const nums = [...new Set(avisos.map((r) => r.empleado_num))];
  const nombres = new Map();
  if (nums.length) {
    const [users] = await credencialesPool.query(
      `SELECT num_empleado, nombre FROM users WHERE num_empleado IN (${nums.map(() => '?').join(',')})`,
      nums
    );
    users.forEach((u) => nombres.set(u.num_empleado, u.nombre));
  }

  return avisos.map((r) => ({ ...r, empleado_nombre: nombres.get(r.empleado_num) || '' }));
}

app.get('/api/guantes/avisos', async (req, res) => {
  try {
    res.json({ avisos: await consultarAvisosGuantes() });
  } catch (error) {
    console.error('Error reading glove warnings:', error);
    res.status(500).json({ error: 'Error al consultar los avisos de guantes' });
  }
});

app.get('/api/guantes/avisos/excel', async (req, res) => {
  try {
    const avisos = await consultarAvisosGuantes();
    const filas = [
      ['Fecha y hora del aviso', 'Número de empleado', 'Nombre', 'Escaneos al avisar'],
      ...avisos.map((a) => [a.avisado_texto, a.empleado_num, a.empleado_nombre, a.escaneos_umbral]),
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(filas), 'Guantes');
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="avisos-guantes.xlsx"');
    res.send(excelBuffer);
  } catch (error) {
    console.error('Error exporting glove warnings:', error);
    res.status(500).json({ error: 'Error al descargar el registro de guantes' });
  }
});

// Scan interval and glove threshold configuration (engineer 179 only)
app.get('/api/txt/config', requireTxtAuth({ authorizerOnly: true }), async (req, res) => {
  try {
    res.json({ config: await getEscaneoConfig() });
  } catch (error) {
    console.error('Error reading config:', error);
    res.status(500).json({ error: 'Error al consultar la configuración' });
  }
});

app.put('/api/txt/config', requireTxtAuth({ authorizerOnly: true }), async (req, res) => {
  const dias = parseIntField(req.body?.dias_minimos_entre_escaneos, 0, 30);
  const guantes = parseIntField(req.body?.escaneos_aviso_guantes, 1, 30);
  const mananaInicio = parseIntField(req.body?.ventana_manana_inicio_min, 0, 1439);
  const mananaFin = parseIntField(req.body?.ventana_manana_fin_min, 0, 1439);
  const tardeInicio = parseIntField(req.body?.ventana_tarde_inicio_min, 0, 1439);
  const tardeFin = parseIntField(req.body?.ventana_tarde_fin_min, 0, 1439);
  const avisoSeg = parseIntField(req.body?.aviso_duracion_seg, 1, 60);

  if (dias === null) {
    return res.status(400).json({ error: 'Días mínimos entre escaneos debe ser un número entero entre 0 y 30.' });
  }
  if (guantes === null) {
    return res.status(400).json({ error: 'Escaneos para aviso de guantes debe ser un número entero entre 1 y 30.' });
  }
  if (mananaInicio === null || mananaFin === null || tardeInicio === null || tardeFin === null) {
    return res.status(400).json({ error: 'Las horas de las ventanas de registro no son válidas.' });
  }
  if (mananaInicio >= mananaFin) {
    return res.status(400).json({ error: 'La ventana de la mañana debe terminar después de su hora de inicio.' });
  }
  if (tardeInicio >= tardeFin) {
    return res.status(400).json({ error: 'La ventana de la tarde debe terminar después de su hora de inicio.' });
  }
  if (avisoSeg === null) {
    return res.status(400).json({ error: 'El tiempo de visualización del aviso debe ser un número entero de segundos entre 1 y 60.' });
  }

  const nuevos = {
    dias_minimos_entre_escaneos: dias,
    escaneos_aviso_guantes: guantes,
    ventana_manana_inicio_min: mananaInicio,
    ventana_manana_fin_min: mananaFin,
    ventana_tarde_inicio_min: tardeInicio,
    ventana_tarde_fin_min: tardeFin,
    aviso_duracion_seg: avisoSeg
  };
  const campos = Object.keys(nuevos);

  let connection;
  try {
    connection = await asistenciaPool.getConnection();
    await connection.beginTransaction();

    await connection.query(
      'INSERT IGNORE INTO escaneo_configuracion (id, dias_minimos_entre_escaneos, escaneos_aviso_guantes) VALUES (1, 1, 3)'
    );
    const [rows] = await connection.query(
      `SELECT ${campos.join(', ')} FROM escaneo_configuracion WHERE id = 1 FOR UPDATE`
    );
    const actual = rows[0];
    const cambios = campos
      .map((campo) => [campo, actual[campo], nuevos[campo]])
      .filter(([, anterior, nuevo]) => Number(anterior) !== nuevo);

    if (cambios.length > 0) {
      await connection.query(
        `UPDATE escaneo_configuracion SET ${campos.map((c) => `${c} = ?`).join(', ')}, updated_by_num = ? WHERE id = 1`,
        [...campos.map((c) => nuevos[c]), req.txtUser.num_empleado]
      );
      for (const [campo, anterior, nuevo] of cambios) {
        await connection.query(
          `INSERT INTO escaneo_configuracion_historial
            (campo, valor_anterior, valor_nuevo, usuario_num_empleado, usuario_id)
           VALUES (?, ?, ?, ?, ?)`,
          [campo, anterior, nuevo, req.txtUser.num_empleado, req.txtUser.id]
        );
      }
    }

    await connection.commit();
    res.json({
      message: cambios.length > 0 ? 'Configuración guardada.' : 'No hubo cambios en la configuración.',
      config: await getEscaneoConfig(),
      cambios: cambios.length
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Error saving config:', error);
    res.status(500).json({ error: 'Error al guardar la configuración' });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/txt/config/historial', requireTxtAuth({ authorizerOnly: true }), async (req, res) => {
  try {
    const [rows] = await asistenciaPool.query(
      `SELECT id, campo, valor_anterior, valor_nuevo, usuario_num_empleado, changed_at
         FROM escaneo_configuracion_historial
        ORDER BY changed_at DESC, id DESC
        LIMIT 200`
    );
    res.json({ historial: rows });
  } catch (error) {
    console.error('Error reading config history:', error);
    res.status(500).json({ error: 'Error al consultar el historial' });
  }
});

const PORT = process.env.PORT || 3113;

// Start server after a small delay to ensure DB init completes
setTimeout(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}, 1000);
