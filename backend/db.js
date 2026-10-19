const mysql = require('mysql2/promise');
require('dotenv').config();

// Hora de Saltillo, Coahuila (UTC-6 todo el año)
const ZONA_SALTILLO = '-06:00';

const asistenciaPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'asistencia',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: ZONA_SALTILLO
});

// NOW() / CURRENT_TIMESTAMP de la sesión también deben ser hora de Saltillo
asistenciaPool.on('connection', (connection) => {
  connection.query(`SET time_zone = '${ZONA_SALTILLO}'`, (err) => {
    if (err) console.error('No se pudo fijar la zona horaria de la sesión:', err.message);
  });
});

const credencialesPool = mysql.createPool({
  host: process.env.CRED_DB_HOST || 'localhost',
  user: process.env.CRED_DB_USER || 'root',
  password: process.env.CRED_DB_PASSWORD || '',
  database: process.env.CRED_DB_NAME || 'credenciales',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = {
  asistenciaPool,
  credencialesPool
};
