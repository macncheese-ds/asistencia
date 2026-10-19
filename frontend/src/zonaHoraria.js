// Hora de Saltillo, Coahuila (UTC-6 todo el año), igual que el backend
const SALTILLO_OFFSET_MS = -6 * 60 * 60 * 1000;

export function fechaHoySaltillo() {
  return new Date(Date.now() + SALTILLO_OFFSET_MS).toISOString().slice(0, 10);
}

export function horaSaltillo(date = new Date()) {
  return new Date(date.getTime() + SALTILLO_OFFSET_MS).toISOString().slice(11, 19);
}
