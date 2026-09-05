export const DEFAULT_IP = '192.168.1.10';
export const DEFAULT_PORT = '8080';
export const SUCCESS_MARKER = 'Panic routine executed successfully.';
export const STORE_MIC_MODE = '@panic/mic_mode';

export function normalizeIp(raw, fallback = DEFAULT_IP) {
  if (!raw || typeof raw !== 'string') return fallback;
  let v = raw.trim();
  // strip scheme, path, trailing slash
  v = v.replace(/^https?:\/\//i, '');
  v = v.split('/')[0];
  v = v.split(':')[0];
  v = v.trim();
  if (!v) return fallback;
  return v;
}

export function normalizePort(raw, fallback = DEFAULT_PORT) {
  if (raw === undefined || raw === null) return fallback;
  const v = String(raw).trim().replace(/[^0-9]/g, '');
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 1 || n > 65535) return fallback;
  return String(n);
}

export function buildPanicUrl(ip, port) {
  const cleanIp = normalizeIp(ip);
  const cleanPort = normalizePort(port);
  return `http://${cleanIp}:${cleanPort}/panic`;
}

export function buildMicUrl(ip, port) {
  const cleanIp = normalizeIp(ip);
  const cleanPort = normalizePort(port);
  return `ws://${cleanIp}:${cleanPort}/mic`;
}

export function isProbablyLanIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const v = ip.trim();
  // 192.168.x.x, 10.x.x.x, 172.16-31.x.x, or .local hostname
  if (/\.local$/i.test(v)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(v)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return true;
  const m = v.match(/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/);
  if (m) return true;
  return false;
}
