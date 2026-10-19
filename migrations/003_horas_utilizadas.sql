-- Migración 003: registro de horas utilizadas (Tool Room)
-- Ejecutar sobre la base de asistencia (por defecto DB_NAME=asistencia).
-- Es idempotente: usa IF NOT EXISTS y no modifica tablas existentes.
-- Requiere MySQL 8.0.16 o superior para que el CHECK se aplique.
--
-- Cada fila descuenta minutos del disponible del empleado (txt + autorizadas - utilizadas).
-- La fecha es la fecha exacta de uso; puede ser pasada, de hoy o programada a futuro.

CREATE TABLE IF NOT EXISTS horas_utilizadas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empleado_num VARCHAR(50) NOT NULL,
  fecha DATE NOT NULL,
  minutos INT NOT NULL,
  request_token VARCHAR(64) NOT NULL,
  registrado_por_id INT NULL,
  registrado_por_num VARCHAR(50) NOT NULL,
  registrado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_horas_utilizadas_token (request_token),
  INDEX idx_horas_utilizadas_empleado (empleado_num),
  CONSTRAINT chk_horas_utilizadas_minutos CHECK (minutos BETWEEN 1 AND 1440)
);
