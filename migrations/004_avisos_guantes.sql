-- Migración 004: registro de avisos de cambio de guantes
-- Ejecutar sobre la base de asistencia (por defecto DB_NAME=asistencia).
-- Es idempotente: usa IF NOT EXISTS y no modifica tablas existentes.
-- Ejecutar antes de reiniciar el backend: cada escaneo que dispara el aviso inserta una fila aquí.

CREATE TABLE IF NOT EXISTS avisos_guantes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empleado_num VARCHAR(50) NOT NULL,
  fecha DATE NOT NULL,
  escaneos_umbral INT NOT NULL,
  avisado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_avisos_guantes_empleado (empleado_num),
  INDEX idx_avisos_guantes_fecha (fecha)
);
