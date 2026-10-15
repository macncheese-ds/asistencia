-- Migración 002: ventanas de registro configurables y duración del aviso en pantalla.
-- Solo para instalaciones donde escaneo_configuracion ya existía antes de este cambio.
-- Ejecutar una sola vez (MySQL 8 no soporta ADD COLUMN IF NOT EXISTS).
-- El backend también aplica estas columnas automáticamente al iniciar (initDB), así que normalmente no hace falta ejecutar este archivo.
-- Las ventanas se guardan en minutos desde medianoche (410 = 06:50, 600 = 10:00, 1130 = 18:50, 1320 = 22:00).

ALTER TABLE escaneo_configuracion
  ADD COLUMN ventana_manana_inicio_min INT NOT NULL DEFAULT 410,
  ADD COLUMN ventana_manana_fin_min INT NOT NULL DEFAULT 600,
  ADD COLUMN ventana_tarde_inicio_min INT NOT NULL DEFAULT 1130,
  ADD COLUMN ventana_tarde_fin_min INT NOT NULL DEFAULT 1320,
  ADD COLUMN aviso_duracion_seg INT NOT NULL DEFAULT 5;
