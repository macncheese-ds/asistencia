const mysql = require('mysql2/promise');
require('dotenv').config();

const asistenciaPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'asistencia',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
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
