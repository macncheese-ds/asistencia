-- Migración 001: intervalo entre escaneos, aviso de guantes y solicitudes de horas
-- Ejecutar sobre la base de asistencia (por defecto DB_NAME=asistencia).
-- Es idempotente: usa IF NOT EXISTS e INSERT IGNORE, y no borra ni modifica datos existentes
-- (assistance_logs, txt y credenciales se conservan sin cambios).
-- Requiere MySQL 8.0.16 o superior para que los CHECK se apliquen.

CREATE TABLE IF NOT EXISTS escaneo_configuracion (
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
);

INSERT IGNORE INTO escaneo_configuracion (id, dias_minimos_entre_escaneos, escaneos_aviso_guantes) VALUES (1, 1, 3);

CREATE TABLE IF NOT EXISTS escaneo_configuracion_historial (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campo VARCHAR(64) NOT NULL,
  valor_anterior INT NULL,
  valor_nuevo INT NOT NULL,
  usuario_num_empleado VARCHAR(50) NOT NULL,
  usuario_id INT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_config_historial_changed_at (changed_at)
);

-- Contador de escaneos válidos por empleado para el aviso de guantes.
-- Empieza en 0 para todos; no se reconstruye desde assistance_logs.
CREATE TABLE IF NOT EXISTS empleado_contador_guantes (
  num_empleado VARCHAR(50) NOT NULL PRIMARY KEY,
  escaneos INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Solicitudes de horas. El empleado se relaciona por num_empleado (credenciales vive en otra base, sin FK entre bases).
-- Las horas solo cuentan como autorizadas cuando estado = 'autorizada'.
CREATE TABLE IF NOT EXISTS solicitudes_horas (
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
);
