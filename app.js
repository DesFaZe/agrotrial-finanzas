// ── STATE ──────────────────────────────────────────────
let ingresos    = [];
let egresos     = [];
let gastosFijos = [];
let sugerencias = [];
let usuarios    = [];
let editMode    = null;
let currentUser = JSON.parse(sessionStorage.getItem('agrotrial_session_user') || 'null');
let periodo     = sessionStorage.getItem('agrotrial_periodo') || 'mes';
let periodoDia  = sessionStorage.getItem('agrotrial_periodo_dia') || '';
let dbReady     = false;
let lastSaveAt  = '';
let cloudConfig = { apiKey: '', authDomain: '', projectId: '', syncKey: '' };

const DB_NAME = 'agrotrial_finanzas';
const DB_VERSION = 2;
const DB_STORES = ['ingresos', 'egresos', 'gastosfijos', 'usuarios', 'sugerencias', 'meta'];

const PBKDF2_ITERS = 100000;

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? b64ToBuf(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERS },
    key,
    256
  );
  return { hash: bufToB64(bits), salt: saltB64 || bufToB64(salt) };
}

function sessionUserView(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    avatar: u.avatar,
    active: u.active !== false
  };
}

function persistSession(u) {
  currentUser = sessionUserView(u);
  sessionStorage.setItem('agrotrial_session_user', JSON.stringify(currentUser));
}

async function setUserPassword(user, password) {
  const { hash, salt } = await hashPassword(password);
  user.passHash = hash;
  user.passSalt = salt;
  delete user.pass;
}

async function verifyUserPassword(user, password) {
  if (!user) return false;
  if (user.passHash && user.passSalt) {
    const { hash } = await hashPassword(password, user.passSalt);
    return hash === user.passHash;
  }
  if (typeof user.pass === 'string' && user.pass && user.pass === password) {
    await setUserPassword(user, password);
    await persistDB();
    return true;
  }
  return false;
}

const PERIOD_OPTIONS = [
  { id: 'hoy',     label: 'Hoy' },
  { id: 'ayer',    label: 'Ayer' },
  { id: 'dia',     label: 'Por día' },
  { id: '7d',      label: 'Últimos 7 días' },
  { id: 'mes',     label: 'Este mes' },
  { id: 'mes_ant', label: 'Mes anterior' },
  { id: '3m',      label: 'Últimos 3 meses' },
  { id: '1a',      label: '1 año' }
];

const ROLES_CONFIG = {
  admin: {
    title: 'Admin',
    badge: 'Admin',
    badgeClass: 'badge-role-admin',
    allowedPages: ['dashboard', 'ingresos', 'porcobrar', 'egresos', 'gastosfijos', 'rentabilidad', 'reportes', 'sugerencias', 'usuarios'],
    defaultPage: 'dashboard'
  },
  administracion: {
    title: 'Administración',
    badge: 'Administración',
    badgeClass: 'badge-role-administracion',
    allowedPages: ['dashboard', 'rentabilidad', 'reportes', 'ingresos', 'porcobrar', 'egresos', 'gastosfijos', 'sugerencias'],
    defaultPage: 'dashboard'
  },
  contabilidad: {
    title: 'Contabilidad de Carga',
    badge: 'Contabilidad de Carga',
    badgeClass: 'badge-role-contabilidad',
    allowedPages: ['ingresos', 'porcobrar', 'egresos', 'gastosfijos', 'dashboard', 'sugerencias'],
    defaultPage: 'ingresos'
  }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsLitId(id) {
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  const s = String(id ?? '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) return '0';
  return "'" + s + "'";
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_ROLES = new Set(['admin', 'administracion', 'contabilidad']);
const BACKUP_MAX_ROWS = 20000;

function isIsoDate(s) {
  return typeof s === 'string' && ISO_DATE_RE.test(s);
}

function clipStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

function asMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return null;
  return n;
}

function sanitizePago(p) {
  if (!p || typeof p !== 'object') return null;
  const fecha = clipStr(p.fecha, 10);
  const monto = asMoney(p.monto);
  if (!isIsoDate(fecha) || monto == null) return null;
  return { fecha, monto, nota: clipStr(p.nota, 160) };
}

function sanitizeIngreso(x) {
  if (!x || typeof x !== 'object') return null;
  const fecha = clipStr(x.fecha, 10);
  const monto = asMoney(x.monto);
  if (!isIsoDate(fecha) || monto == null || monto <= 0) return null;
  const cobro = x.cobro === 'credito' ? 'credito' : 'contado';
  const pagos = Array.isArray(x.pagos) ? x.pagos.map(sanitizePago).filter(Boolean).slice(0, 200) : [];
  const plazo = cobro === 'credito' ? (Number(x.plazo) || 30) : 0;
  const vencimiento = cobro === 'credito' && isIsoDate(x.vencimiento) ? x.vencimiento : (cobro === 'credito' ? addDaysISO(fecha, plazo) : fecha);
  let estadoCobro = 'cobrado';
  if (cobro === 'credito') {
    if (x.estadoCobro === 'parcial' || x.estadoCobro === 'pendiente' || x.estadoCobro === 'cobrado') estadoCobro = x.estadoCobro;
    else estadoCobro = 'pendiente';
  }
  const id = (typeof x.id === 'number' && Number.isFinite(x.id)) ? x.id : Date.now() + Math.floor(Math.random() * 1000);
  return {
    id,
    fecha,
    desc: clipStr(x.desc, 240) || 'Venta',
    cat: clipStr(x.cat, 80) || 'Ventas',
    cliente: clipStr(x.cliente, 120),
    monto,
    cobro,
    plazo: plazo > 0 && plazo < 3650 ? plazo : 30,
    vencimiento,
    estadoCobro,
    fechaCobro: isIsoDate(x.fechaCobro) ? x.fechaCobro : '',
    pagos,
    montoCobrado: asMoney(x.montoCobrado) ?? 0,
    notaCredito: clipStr(x.notaCredito, 200)
  };
}

function sanitizeEgreso(x) {
  if (!x || typeof x !== 'object') return null;
  const fecha = clipStr(x.fecha, 10);
  const monto = asMoney(x.monto);
  if (!isIsoDate(fecha) || monto == null || monto <= 0) return null;
  const id = (typeof x.id === 'number' && Number.isFinite(x.id)) ? x.id : Date.now() + Math.floor(Math.random() * 1000);
  return {
    id,
    fecha,
    desc: clipStr(x.desc, 240) || 'Egreso',
    cat: clipStr(x.cat, 80) || 'Otros',
    proveedor: clipStr(x.proveedor, 120),
    monto
  };
}

function sanitizeGastoFijo(x) {
  if (!x || typeof x !== 'object') return null;
  const monto = asMoney(x.monto);
  if (monto == null || monto <= 0) return null;
  const id = (typeof x.id === 'number' && Number.isFinite(x.id)) ? x.id : Date.now() + Math.floor(Math.random() * 1000);
  return {
    id,
    desc: clipStr(x.desc, 240) || 'Gasto fijo',
    cat: clipStr(x.cat, 80) || 'Otros',
    frec: x.frec === 'anual' ? 'anual' : 'mensual',
    monto,
    activo: x.activo !== false
  };
}

function sanitizeSugerencia(x) {
  if (!x || typeof x !== 'object') return null;
  const estados = new Set(['pendiente', 'recibida', 'proceso', 'hecha']);
  const id = (typeof x.id === 'number' && Number.isFinite(x.id)) ? x.id : Date.now();
  return {
    id,
    nombre: clipStr(x.nombre, 120) || 'Sugerencia',
    desc: clipStr(x.desc, 800),
    cat: clipStr(x.cat, 80) || 'Otros',
    prioridad: clipStr(x.prioridad, 20) || 'media',
    estado: estados.has(x.estado) ? x.estado : 'pendiente',
    autor: clipStr(x.autor, 80),
    autorId: clipStr(x.autorId, 80),
    fecha: clipStr(x.fecha, 32)
  };
}

function sanitizeUsuario(x) {
  if (!x || typeof x !== 'object') return null;
  const email = clipStr(x.email, 120).toLowerCase();
  const name = clipStr(x.name, 80);
  if (!email || !name || !email.includes('@')) return null;
  const role = ALLOWED_ROLES.has(x.role) ? x.role : 'contabilidad';
  const id = /^[A-Za-z0-9_-]{1,80}$/.test(String(x.id || '')) ? String(x.id) : ('u_' + Date.now());
  const user = {
    id,
    name,
    email,
    role,
    active: x.active !== false,
    avatar: clipStr(x.avatar, 8) || '👤'
  };
  if (typeof x.pass === 'string' && x.pass) user.pass = x.pass.slice(0, 200);
  if (typeof x.passHash === 'string' && x.passHash) user.passHash = x.passHash.slice(0, 200);
  if (typeof x.passSalt === 'string' && x.passSalt) user.passSalt = x.passSalt.slice(0, 200);
  return user;
}

function parseBackupPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'El archivo no es un respaldo válido' };
  }
  if (!Array.isArray(data.ingresos) || !Array.isArray(data.egresos)) {
    return { error: 'Faltan ingresos o egresos en el archivo' };
  }
  if (data.ingresos.length > BACKUP_MAX_ROWS || data.egresos.length > BACKUP_MAX_ROWS) {
    return { error: 'El archivo tiene demasiados registros' };
  }
  const ingresosOk = data.ingresos.map(sanitizeIngreso).filter(Boolean);
  const egresosOk = data.egresos.map(sanitizeEgreso).filter(Boolean);
  if (!ingresosOk.length && data.ingresos.length) return { error: 'Ningún ingreso del archivo es válido' };
  if (!egresosOk.length && data.egresos.length) return { error: 'Ningún egreso del archivo es válido' };
  const gastosFijosOk = Array.isArray(data.gastosFijos)
    ? data.gastosFijos.map(sanitizeGastoFijo).filter(Boolean).slice(0, 2000)
    : [];
  const sugerenciasOk = Array.isArray(data.sugerencias)
    ? data.sugerencias.map(sanitizeSugerencia).filter(Boolean).slice(0, 2000)
    : null;
  const usuariosOk = Array.isArray(data.usuarios)
    ? data.usuarios.map(sanitizeUsuario).filter(Boolean).slice(0, 200)
    : null;
  return {
    ingresos: ingresosOk,
    egresos: egresosOk,
    gastosFijos: gastosFijosOk,
    sugerencias: sugerenciasOk,
    usuarios: usuariosOk
  };
}

let idbHandle = null;
let persistChain = Promise.resolve();

function nextId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function sameId(a, b) {
  return String(a) === String(b);
}

function openIndexedDB() {
  if (idbHandle) return Promise.resolve(idbHandle);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      DB_STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      });
    };
    req.onsuccess = () => {
      idbHandle = req.result;
      idbHandle.onclose = () => { idbHandle = null; };
      idbHandle.onversionchange = () => {
        try { idbHandle.close(); } catch (e) { /* ignore */ }
        idbHandle = null;
      };
      resolve(idbHandle);
    };
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(store) {
  return openIndexedDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

async function persistDB() {
  const db = await openIndexedDB();
  const payload = {
    ingresos,
    egresos,
    gastosfijos: gastosFijos,
    usuarios,
    sugerencias
  };
  lastSaveAt = new Date().toISOString();
  await new Promise((resolve, reject) => {
    const stores = ['ingresos', 'egresos', 'gastosfijos', 'usuarios', 'sugerencias', 'meta'];
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach(name => {
      const os = tx.objectStore(name);
      if (name === 'meta') {
        os.put({
          id: 'app',
          lastSave: lastSaveAt,
          cloud: {
            apiKey: cloudConfig.apiKey || '',
            authDomain: cloudConfig.authDomain || '',
            projectId: cloudConfig.projectId || '',
            syncKey: cloudConfig.syncKey || ''
          }
        });
        return;
      }
      os.clear();
      (payload[name] || []).forEach(item => {
        if (item && item.id != null) os.put(item);
      });
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readLocalArray(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { return null; }
}

async function loadDatabase() {
  let loadedUsers = await idbGetAll('usuarios');
  ingresos    = await idbGetAll('ingresos');
  egresos     = await idbGetAll('egresos');
  gastosFijos = await idbGetAll('gastosfijos');
  sugerencias = await idbGetAll('sugerencias');
  const metaRows = await idbGetAll('meta');
  const appMeta = (metaRows || []).find(x => x.id === 'app');
  if (appMeta) {
    lastSaveAt = appMeta.lastSave || '';
    if (appMeta.cloud && typeof appMeta.cloud === 'object') {
      cloudConfig = {
        apiKey: appMeta.cloud.apiKey || '',
        authDomain: appMeta.cloud.authDomain || '',
        projectId: appMeta.cloud.projectId || '',
        syncKey: appMeta.cloud.syncKey || ''
      };
    }
  }

  const lsIng = readLocalArray('agrotrial_ingresos');
  const lsEgr = readLocalArray('agrotrial_egresos');
  const lsGf  = readLocalArray('agrotrial_gastosfijos');
  const lsSug = readLocalArray('agrotrial_sugerencias');
  const lsUsr = readLocalArray('agrotrial_usuarios');

  if (!ingresos.length && Array.isArray(lsIng) && lsIng.length) ingresos = lsIng;
  if (!egresos.length && Array.isArray(lsEgr) && lsEgr.length) egresos = lsEgr;
  if (!gastosFijos.length && Array.isArray(lsGf) && lsGf.length) gastosFijos = lsGf;
  if (!sugerencias.length && Array.isArray(lsSug) && lsSug.length) sugerencias = lsSug;
  if (!loadedUsers.length && Array.isArray(lsUsr) && lsUsr.length) loadedUsers = lsUsr;

  usuarios = loadedUsers;
  dbReady = true;
  await persistDB();
}

function save() {
  persistChain = persistChain.then(() => persistDB(), () => persistDB()).catch(() => {
    showToast('No se pudo guardar en la base de datos');
  });
  return persistChain;
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getPeriodBounds() {
  const today = startOfDay(new Date());
  const endToday = toISODate(today);
  if (periodo === 'hoy') return { start: endToday, end: endToday };
  if (periodo === 'ayer') {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    const iso = toISODate(y);
    return { start: iso, end: iso };
  }
  if (periodo === 'dia') {
    const iso = periodoDia || endToday;
    return { start: iso, end: iso };
  }
  if (periodo === '7d') {
    const s = new Date(today); s.setDate(s.getDate() - 6);
    return { start: toISODate(s), end: endToday };
  }
  if (periodo === 'mes') {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: toISODate(s), end: endToday };
  }
  if (periodo === 'mes_ant') {
    const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: toISODate(s), end: toISODate(e) };
  }
  if (periodo === '3m') {
    const s = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    return { start: toISODate(s), end: endToday };
  }
  if (periodo === '1a') {
    const s = new Date(today); s.setFullYear(s.getFullYear() - 1);
    return { start: toISODate(s), end: endToday };
  }
  return { start: '0000-01-01', end: endToday };
}

function inPeriodo(fechaStr) {
  if (!fechaStr) return false;
  const { start, end } = getPeriodBounds();
  return fechaStr >= start && fechaStr <= end;
}

function ingresosFiltrados() { return ingresos.filter(x => inPeriodo(x.fecha)); }
function egresosFiltrados()  { return egresos.filter(x => inPeriodo(x.fecha)); }

function addDaysISO(fecha, days) {
  if (!fecha) return '';
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + Number(days || 0));
  return toISODate(dt);
}

function normalizeIngreso(x) {
  const cobro = x.cobro || 'contado';
  const plazo = Number(x.plazo) || (cobro === 'credito' ? 30 : 0);
  const vencimiento = x.vencimiento || (cobro === 'credito' ? addDaysISO(x.fecha, plazo) : x.fecha);
  const pagos = Array.isArray(x.pagos) ? x.pagos.slice() : [];
  let montoCobrado = pagos.reduce((s, p) => s + Number(p.monto || 0), 0);
  if (!pagos.length) {
    if (cobro !== 'credito' || x.estadoCobro === 'cobrado') montoCobrado = Number(x.montoCobrado || x.monto || 0);
    else montoCobrado = Number(x.montoCobrado || 0);
  }
  if (cobro !== 'credito') montoCobrado = Number(x.monto || 0);
  const saldo = Math.max(0, Number(x.monto || 0) - montoCobrado);
  let estadoCobro = 'pendiente';
  if (cobro !== 'credito' || saldo <= 0.009) estadoCobro = 'cobrado';
  else if (montoCobrado > 0.009) estadoCobro = 'parcial';
  const lastPago = pagos.length ? pagos[pagos.length - 1].fecha : '';
  const fechaCobro = estadoCobro === 'cobrado' ? (x.fechaCobro || lastPago || x.fecha) : lastPago;
  return { ...x, cobro, plazo, vencimiento, pagos, montoCobrado, saldo, estadoCobro, fechaCobro };
}

function isCreditoPendiente(x) {
  const n = normalizeIngreso(x);
  return n.cobro === 'credito' && n.saldo > 0.009;
}

function isCreditoVencido(x) {
  return isCreditoPendiente(x) && normalizeIngreso(x).vencimiento < toISODate(new Date());
}

function diasHastaVencimiento(x) {
  const n = normalizeIngreso(x);
  if (!n.vencimiento) return 0;
  const [y, m, d] = n.vencimiento.split('-').map(Number);
  const v = new Date(y, m - 1, d);
  const t = startOfDay(new Date());
  return Math.round((v - t) / 86400000);
}

function pagosDeIngreso(x) {
  const n = normalizeIngreso(x);
  if (n.pagos.length) return n.pagos;
  if (n.cobro !== 'credito') return [{ fecha: n.fecha, monto: n.monto, nota: 'Contado' }];
  if (n.estadoCobro === 'cobrado' && n.fechaCobro) return [{ fecha: n.fechaCobro, monto: n.monto, nota: 'Cobro' }];
  return [];
}

function setTipoVenta(tipo) {
  const inp = document.getElementById('ing-cobro');
  if (inp) inp.value = tipo;
  document.querySelectorAll('#ing-sale-type .sale-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === tipo);
  });
  onIngCobroChange();
}

function onIngCobroChange() {
  const cobroEl = document.getElementById('ing-cobro');
  if (!cobroEl) return;
  const credito = cobroEl.value === 'credito';
  const plazoWrap = document.getElementById('ing-plazo-wrap');
  const vencWrap = document.getElementById('ing-venc-wrap');
  if (plazoWrap) plazoWrap.hidden = !credito;
  if (vencWrap) vencWrap.hidden = !credito;
  const hint = document.getElementById('ing-tipo-hint');
  if (hint) {
    hint.textContent = credito
      ? 'El cliente paga después. La venta entra a Por cobrar hasta que la cobrés.'
      : 'El cliente paga ahora. Entra a caja.';
  }
  const cliLab = document.getElementById('ing-cliente-label');
  if (cliLab) cliLab.textContent = credito ? 'Cliente (obligatorio)' : 'Cliente / Comprador';
  if (credito) onIngPlazoChange();
}

function onIngPlazoChange() {
  const fecha = document.getElementById('ing-fecha').value;
  const plazo = document.getElementById('ing-plazo').value;
  const venc = document.getElementById('ing-vencimiento');
  if (fecha && venc) venc.value = addDaysISO(fecha, plazo);
}

function daysInCalendarMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

function daysInclusive(startIso, endIso) {
  const [ys, ms, ds] = startIso.split('-').map(Number);
  const [ye, me, de] = endIso.split('-').map(Number);
  const a = new Date(ys, ms - 1, ds);
  const b = new Date(ye, me - 1, de);
  return Math.max(0, Math.round((b - a) / 86400000) + 1);
}

function gastosFijosEnRango(start, end, lista) {
  const items = (lista || gastosFijos).filter(g => g.activo);
  const gfMes = items.reduce((s, g) => s + (g.frec === 'anual' ? g.monto / 12 : g.monto), 0);
  if (!start || !end || gfMes === 0) return 0;
  const [ys, ms] = start.split('-').map(Number);
  const [ye, me] = end.split('-').map(Number);
  let total = 0;
  let y = ys, m = ms;
  while (y < ye || (y === ye && m <= me)) {
    const dim = daysInCalendarMonth(y, m);
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
    const from = start > monthStart ? start : monthStart;
    const to = end < monthEnd ? end : monthEnd;
    if (from <= to) total += gfMes * (daysInclusive(from, to) / dim);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return total;
}

function gastosFijosEnPeriodo() {
  const { start, end } = getPeriodBounds();
  return gastosFijosEnRango(start, end, gastosFijos);
}

function gastosFijosPorCategoriaEnPeriodo() {
  const { start, end } = getPeriodBounds();
  const cats = {};
  gastosFijos.filter(g => g.activo).forEach(g => {
    const mensual = g.frec === 'anual' ? g.monto / 12 : g.monto;
    const v = gastosFijosEnRango(start, end, [{ activo: true, frec: 'mensual', monto: mensual }]);
    cats[g.cat] = (cats[g.cat] || 0) + v;
  });
  return cats;
}

function periodLabel() {
  return (PERIOD_OPTIONS.find(p => p.id === periodo) || {}).label || 'Período';
}

function renderPeriodFilters() {
  const host = document.getElementById('period-filters');
  if (!host) return;
  host.innerHTML = PERIOD_OPTIONS.map(p =>
    `<button type="button" class="period-chip ${periodo === p.id ? 'active' : ''}" data-period="${p.id}">${p.label}</button>`
  ).join('');
  host.querySelectorAll('.period-chip').forEach(btn => {
    btn.onclick = () => setPeriodo(btn.dataset.period);
  });
  const dia = document.getElementById('period-dia');
  if (dia) {
    dia.hidden = periodo !== 'dia';
    if (periodo === 'dia') dia.value = periodoDia || toISODate(new Date());
  }
}

function setPeriodo(id) {
  periodo = id;
  sessionStorage.setItem('agrotrial_periodo', id);
  if (id === 'dia' && !periodoDia) {
    periodoDia = toISODate(new Date());
    sessionStorage.setItem('agrotrial_periodo_dia', periodoDia);
  }
  renderPeriodFilters();
  refreshAll();
}

function setPeriodoDia(value) {
  periodo = 'dia';
  periodoDia = value;
  sessionStorage.setItem('agrotrial_periodo', 'dia');
  sessionStorage.setItem('agrotrial_periodo_dia', value);
  renderPeriodFilters();
  refreshAll();
}

document.addEventListener('DOMContentLoaded', () => { bootApp(); });

async function bootApp() {
  try {
    await loadDatabase();
  } catch (err) {
    usuarios = [];
    showToast('La base de datos no pudo abrirse. Creá un administrador para este dispositivo.');
  }

  const now = new Date();
  const yearBadge = document.getElementById('badge-year');
  if (yearBadge) yearBadge.textContent = now.getFullYear();
  document.getElementById('sidebar-date').textContent = now.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
  document.getElementById('report-date').textContent  = 'Generado: ' + now.toLocaleDateString('es-AR');

  const today = toISODate(now);
  document.getElementById('ing-fecha').value  = today;
  document.getElementById('egr-fecha').value  = today;
  const pcFecha = document.getElementById('pc-fecha');
  if (pcFecha) pcFecha.value = today;
  document.getElementById('ing-fecha').addEventListener('change', onIngPlazoChange);
  onIngCobroChange();
  onPcPlazoChange();
  renderPeriodFilters();

  if (currentUser && (currentUser.pass || currentUser.passHash || currentUser.passSalt)) {
    persistSession(currentUser);
  }
  if (currentUser && usuarios.some(u => u.id === currentUser.id && u.active)) {
    persistSession(usuarios.find(u => u.id === currentUser.id));
    showAppLayout();
    applyUserRolePermissions();
    refreshAll();
  } else {
    currentUser = null;
    sessionStorage.removeItem('agrotrial_session_user');
    showLoginScreen();
  }
}

// ── NAVIGATION ─────────────────────────────────────────
function showPage(name, el) {
  closeSidebar();
  const config = ROLES_CONFIG[currentUser ? currentUser.role : 'administracion'] || ROLES_CONFIG.administracion;
  if (!config.allowedPages.includes(name)) {
    showToast('Tu rol no tiene permisos para ver esta sección');
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  const target = document.getElementById('page-' + name);
  if (target) target.classList.add('active');
  
  if (el) {
    el.classList.add('active');
  } else {
    const matchingNav = document.querySelector(`.nav-item[data-page="${name}"]`);
    if (matchingNav) matchingNav.classList.add('active');
  }

  document.getElementById('page-title').textContent =
    { dashboard:'Dashboard', ingresos:'Ventas', porcobrar:'Por cobrar', egresos:'Egresos',
      rentabilidad:'Rentabilidad', gastosfijos:'Gastos Fijos', reportes:'Reportes',
      sugerencias: (currentUser && currentUser.role === 'admin') ? 'Bandeja de sugerencias' : 'Enviar sugerencia',
      usuarios:'Gestión de Usuarios' }[name] || name;
  refreshAll();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('open', sidebar.classList.contains('open'));
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

// ── ADD INGRESO ────────────────────────────────────────
function pushIngreso({ fecha, desc, cat, cliente, monto, cobro, plazo, vencimiento }) {
  const esCredito = cobro === 'credito';
  ingresos.push({
    id: nextId(), fecha, desc, cat, cliente, monto,
    cobro, plazo: esCredito ? plazo : 0,
    vencimiento: esCredito ? (vencimiento || addDaysISO(fecha, plazo)) : fecha,
    estadoCobro: esCredito ? 'pendiente' : 'cobrado',
    fechaCobro: esCredito ? '' : fecha,
    pagos: esCredito ? [] : [{ fecha, monto, nota: 'Contado' }],
    montoCobrado: esCredito ? 0 : monto,
    notaCredito: ''
  });
}

function addIngreso() {
  const fecha   = document.getElementById('ing-fecha').value;
  const desc    = document.getElementById('ing-desc').value.trim();
  const cat     = document.getElementById('ing-cat').value;
  const cliente = document.getElementById('ing-cliente').value.trim();
  const monto   = parseFloat(document.getElementById('ing-monto').value);
  const cobro   = document.getElementById('ing-cobro').value;
  const plazo   = Number(document.getElementById('ing-plazo').value) || 30;
  const vencimiento = document.getElementById('ing-vencimiento').value || addDaysISO(fecha, plazo);

  if (!fecha || !desc || !monto || monto <= 0) { showToast('Completá fecha, descripción y monto'); return; }
  if (cobro === 'credito' && !cliente) { showToast('En crédito a plazo el cliente es obligatorio'); return; }

  pushIngreso({ fecha, desc, cat, cliente, monto, cobro, plazo, vencimiento });
  save(); refreshAll();
  document.getElementById('ing-desc').value = '';
  document.getElementById('ing-cliente').value = '';
  document.getElementById('ing-monto').value = '';
  setTipoVenta('contado');
  showToast(cobro === 'credito' ? 'Venta a crédito cargada. Queda por cobrar.' : 'Venta de contado registrada');
}

function onPcPlazoChange() {
  const fecha = document.getElementById('pc-fecha')?.value;
  const plazo = document.getElementById('pc-plazo')?.value;
  const venc = document.getElementById('pc-vencimiento');
  if (fecha && venc) venc.value = addDaysISO(fecha, plazo);
}

function addCredito() {
  const fecha = document.getElementById('pc-fecha').value;
  const cliente = document.getElementById('pc-cliente').value.trim();
  const desc = document.getElementById('pc-desc').value.trim();
  const cat = document.getElementById('pc-cat').value;
  const monto = parseFloat(document.getElementById('pc-monto').value);
  const plazo = Number(document.getElementById('pc-plazo').value) || 30;
  const vencimiento = document.getElementById('pc-vencimiento').value || addDaysISO(fecha, plazo);

  if (!fecha || !desc || !monto || monto <= 0) { showToast('Completá fecha, descripción y monto'); return; }
  if (!cliente) { showToast('El cliente es obligatorio para cargar un crédito'); return; }

  pushIngreso({ fecha, desc, cat, cliente, monto, cobro: 'credito', plazo, vencimiento });
  save(); refreshAll();
  document.getElementById('pc-cliente').value = '';
  document.getElementById('pc-desc').value = '';
  document.getElementById('pc-monto').value = '';
  onPcPlazoChange();
  showToast('Venta a crédito cargada');
}

function marcarCobrado(id) {
  aplicarPago(id, null, toISODate(new Date()), 'Cobro total');
}

let cobroTargetId = null;
let prorrogaTargetId = null;

function openCobroModal(id) {
  const item = ingresos.find(x => sameId(x.id, id));
  if (!item) return;
  const n = normalizeIngreso(item);
  cobroTargetId = id;
  document.getElementById('cobro-modal-info').textContent =
    `${n.cliente || 'Cliente'} · ${n.desc} · Saldo ${fmtMoney(n.saldo)}`;
  document.getElementById('cobro-fecha').value = toISODate(new Date());
  document.getElementById('cobro-monto').value = n.saldo.toFixed(2);
  document.getElementById('cobro-nota').value = '';
  document.getElementById('modal-cobro').classList.add('open');
}

function closeCobroModal() {
  document.getElementById('modal-cobro').classList.remove('open');
  cobroTargetId = null;
}

function cobrarSaldoCompleto() {
  if (cobroTargetId == null) return;
  const fecha = document.getElementById('cobro-fecha').value || toISODate(new Date());
  const nota = document.getElementById('cobro-nota').value.trim();
  aplicarPago(cobroTargetId, null, fecha, nota || 'Cobro total');
  closeCobroModal();
}

function confirmarCobroParcial() {
  if (cobroTargetId == null) return;
  const monto = parseFloat(document.getElementById('cobro-monto').value);
  const fecha = document.getElementById('cobro-fecha').value || toISODate(new Date());
  const nota = document.getElementById('cobro-nota').value.trim();
  if (!monto || monto <= 0) { showToast('Ingresá un monto de cobro'); return; }
  aplicarPago(cobroTargetId, monto, fecha, nota);
  closeCobroModal();
}

function aplicarPago(id, montoOpcional, fecha, nota) {
  const i = ingresos.find(x => sameId(x.id, id));
  if (!i) return;
  const n = normalizeIngreso(i);
  const monto = montoOpcional == null ? n.saldo : montoOpcional;
  if (monto > n.saldo + 0.01) { showToast('El cobro no puede superar el saldo'); return; }
  i.pagos = n.pagos.concat([{ fecha, monto, nota: nota || '' }]);
  const cobrado = i.pagos.reduce((s, p) => s + Number(p.monto || 0), 0);
  i.montoCobrado = cobrado;
  i.estadoCobro = cobrado + 0.009 >= n.monto ? 'cobrado' : 'parcial';
  i.fechaCobro = i.estadoCobro === 'cobrado' ? fecha : '';
  save(); refreshAll();
  showToast(i.estadoCobro === 'cobrado' ? 'Crédito cobrado' : 'Cobro parcial registrado');
}

function openProrrogaModal(id) {
  const item = ingresos.find(x => sameId(x.id, id));
  if (!item) return;
  const n = normalizeIngreso(item);
  prorrogaTargetId = id;
  document.getElementById('prorroga-modal-info').textContent =
    `${n.cliente || 'Cliente'} · vence ${fmtDate(n.vencimiento)}`;
  document.getElementById('prorroga-fecha').value = n.vencimiento;
  document.getElementById('modal-prorroga').classList.add('open');
}

function closeProrrogaModal() {
  document.getElementById('modal-prorroga').classList.remove('open');
  prorrogaTargetId = null;
}

function confirmarProrroga() {
  const i = ingresos.find(x => sameId(x.id, prorrogaTargetId));
  const fecha = document.getElementById('prorroga-fecha').value;
  if (!i || !fecha) { showToast('Elegí una fecha'); return; }
  i.vencimiento = fecha;
  save(); refreshAll();
  closeProrrogaModal();
  showToast('Vencimiento actualizado');
}

// ── ADD EGRESO ─────────────────────────────────────────
function addEgreso() {
  const fecha      = document.getElementById('egr-fecha').value;
  const desc       = document.getElementById('egr-desc').value.trim();
  const cat        = document.getElementById('egr-cat').value;
  const proveedor  = document.getElementById('egr-proveedor').value.trim();
  const monto      = parseFloat(document.getElementById('egr-monto').value);

  if (!fecha || !desc || !monto || monto <= 0) { showToast('⚠️ Completa todos los campos obligatorios'); return; }

  egresos.push({ id: nextId(), fecha, desc, cat, proveedor, monto });
  save(); refreshAll();
  document.getElementById('egr-desc').value = '';
  document.getElementById('egr-proveedor').value = '';
  document.getElementById('egr-monto').value = '';
  showToast('✅ Egreso registrado correctamente');
}

// ── DELETE ─────────────────────────────────────────────
function deleteItem(type, id) {
  if (!confirm('¿Eliminar este registro?')) return;
  if (type === 'ingreso') ingresos = ingresos.filter(x => !sameId(x.id, id));
  else                    egresos  = egresos.filter(x => !sameId(x.id, id));
  save(); refreshAll(); showToast('🗑️ Registro eliminado');
}

// ── EDIT MODAL ─────────────────────────────────────────
function openEdit(type, id) {
  const item = type === 'ingreso'
    ? ingresos.find(x => sameId(x.id, id))
    : egresos.find(x => sameId(x.id, id));
  if (!item) return;
  editMode = { type, id };
  document.getElementById('modal-title').textContent = type === 'ingreso' ? '✏️ Editar Ingreso' : '✏️ Editar Egreso';

  const cats = type === 'ingreso'
    ? ['Ventas','Servicios','Subsidios','Arrendamiento','Otros']
    : ['Insumos','Semillas','Agroquímicos','Mano de Obra','Maquinaria','Combustible','Administración','Impuestos','Otros'];

  const thirdLabel = type === 'ingreso' ? 'Cliente' : 'Proveedor';
  const thirdVal   = type === 'ingreso' ? (item.cliente||'') : (item.proveedor||'');
  const n = type === 'ingreso' ? normalizeIngreso(item) : item;
  const creditoFields = type === 'ingreso' ? `
    <div class="form-group">
      <label>Tipo de venta</label>
      <select id="m-cobro" class="form-input">
        <option value="contado"${n.cobro!=='credito'?' selected':''}>Contado</option>
        <option value="credito"${n.cobro==='credito'?' selected':''}>Crédito</option>
      </select>
    </div>
    <div class="form-group">
      <label>Plazo (días)</label>
      <input type="number" id="m-plazo" class="form-input" value="${escapeHtml(n.plazo||30)}" min="1"/>
    </div>
    <div class="form-group">
      <label>Vencimiento</label>
      <input type="date" id="m-vencimiento" class="form-input" value="${escapeHtml(n.vencimiento||'')}"/>
    </div>
    <div class="form-group">
      <label>Estado de cobro</label>
      <input class="form-input" value="${escapeHtml(n.estadoCobro==='cobrado'?'Cobrado':(n.estadoCobro==='parcial'?'Pago parcial':'Pendiente'))}" disabled/>
      <div class="field-hint">Los cobros no se borran al editar. Registrá pagos en Por cobrar.</div>
    </div>` : '';

  document.getElementById('modal-form').innerHTML = `
    <div class="form-group">
      <label>Fecha</label>
      <input type="date" id="m-fecha" class="form-input" value="${escapeHtml(item.fecha)}"/>
    </div>
    <div class="form-group">
      <label>Descripción</label>
      <input type="text" id="m-desc" class="form-input" value="${escapeHtml(item.desc)}"/>
    </div>
    <div class="form-group">
      <label>Categoría</label>
      <select id="m-cat" class="form-input">
        ${cats.map(c => `<option${c===item.cat?' selected':''}>${escapeHtml(c)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>${thirdLabel}</label>
      <input type="text" id="m-third" class="form-input" value="${escapeHtml(thirdVal)}"/>
    </div>
    <div class="form-group">
      <label>Monto ($)</label>
      <input type="number" id="m-monto" class="form-input" value="${escapeHtml(item.monto)}" step="0.01"/>
    </div>
    ${creditoFields}`;

  document.getElementById('modal').classList.add('open');
}

function applyIngresoEdit(prev, fields) {
  const fecha = fields.fecha;
  const cobro = fields.cobro === 'credito' ? 'credito' : 'contado';
  const plazo = cobro === 'credito' ? (Number(fields.plazo) || 30) : 0;
  const vencimiento = cobro === 'credito'
    ? (fields.vencimiento || addDaysISO(fecha, plazo))
    : fecha;
  let pagos = Array.isArray(prev.pagos) ? prev.pagos.map(p => ({ ...p })) : [];
  if (cobro !== 'credito') {
    pagos = [{ fecha, monto: fields.monto, nota: 'Contado' }];
  }
  const cobrado = pagos.reduce((s, p) => s + Number(p.monto || 0), 0);
  const saldo = Math.max(0, Number(fields.monto) - cobrado);
  let estadoCobro = 'pendiente';
  if (cobro !== 'credito' || saldo <= 0.009) estadoCobro = 'cobrado';
  else if (cobrado > 0.009) estadoCobro = 'parcial';
  return {
    ...prev,
    fecha,
    desc: fields.desc,
    cat: fields.cat,
    cliente: fields.cliente,
    monto: fields.monto,
    cobro,
    plazo,
    vencimiento,
    pagos,
    montoCobrado: cobrado,
    estadoCobro,
    fechaCobro: estadoCobro === 'cobrado' ? (pagos.length ? pagos[pagos.length - 1].fecha : fecha) : ''
  };
}

function saveEdit() {
  const { type, id } = editMode;
  const fecha = document.getElementById('m-fecha').value;
  const desc  = document.getElementById('m-desc').value.trim();
  const cat   = document.getElementById('m-cat').value;
  const third = document.getElementById('m-third').value.trim();
  const monto = parseFloat(document.getElementById('m-monto').value);
  if (!fecha || !desc || !monto) { showToast('Completá todos los campos'); return; }

  if (type === 'ingreso') {
    const i = ingresos.findIndex(x => sameId(x.id, id));
    if (i < 0) return;
    const cobro = document.getElementById('m-cobro').value;
    const plazo = Number(document.getElementById('m-plazo').value) || 30;
    const vencimiento = document.getElementById('m-vencimiento').value || addDaysISO(fecha, plazo);
    ingresos[i] = applyIngresoEdit(ingresos[i], {
      fecha, desc, cat, cliente: third, monto, cobro, plazo, vencimiento
    });
  } else {
    const i = egresos.findIndex(x => sameId(x.id, id));
    if (i < 0) return;
    egresos[i] = { ...egresos[i], fecha, desc, cat, proveedor: third, monto };
  }
  save(); refreshAll(); closeModal(); showToast('Cambios guardados');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  editMode = null;
}

// ── RENDER INGRESOS TABLE ──────────────────────────────
function cobroBadge(x) {
  const n = normalizeIngreso(x);
  if (n.cobro !== 'credito') return '<span class="badge badge-income">Contado</span>';
  if (n.estadoCobro === 'cobrado') return '<span class="badge badge-income">Crédito cobrado</span>';
  if (isCreditoVencido(n)) return '<span class="badge badge-overdue">Crédito vencido</span>';
  if (n.estadoCobro === 'parcial') return '<span class="badge badge-credit">Crédito parcial</span>';
  return `<span class="badge badge-credit">Crédito ${n.plazo} días</span>`;
}

function renderIngresos() {
  const search = (document.getElementById('ing-search')?.value || '').toLowerCase();
  const catF   = document.getElementById('ing-filter-cat')?.value || '';
  const cobroF = document.getElementById('ing-filter-cobro')?.value || '';
  let data = ingresosFiltrados().filter(x => {
    const n = normalizeIngreso(x);
    const textOk = !search || n.desc.toLowerCase().includes(search) || (n.cliente||'').toLowerCase().includes(search);
    const catOk = !catF || n.cat === catF;
    let cobroOk = true;
    if (cobroF === 'contado') cobroOk = n.cobro !== 'credito';
    if (cobroF === 'pendiente') cobroOk = isCreditoPendiente(n);
    if (cobroF === 'vencido') cobroOk = isCreditoVencido(n);
    if (cobroF === 'cobrado') cobroOk = n.cobro === 'credito' && n.estadoCobro === 'cobrado';
    return textOk && catOk && cobroOk;
  }).sort((a,b) => b.fecha.localeCompare(a.fecha));

  const tbody = document.getElementById('ingresos-tbody');
  if (!tbody) return;
  tbody.innerHTML = data.length ? data.map(x => {
    const n = normalizeIngreso(x);
    const cobrarBtn = isCreditoPendiente(n)
      ? `<button class="btn-cobrar" onclick="openCobroModal(${jsLitId(n.id)})">Cobrar</button>`
      : '';
    return `
    <tr>
      <td>${fmtDate(n.fecha)}</td>
      <td>${escapeHtml(n.desc)}</td>
      <td><span class="badge badge-income">${escapeHtml(n.cat)}</span></td>
      <td>${escapeHtml(n.cliente||'–')}</td>
      <td>${cobroBadge(n)}</td>
      <td>${n.cobro==='credito' ? fmtDate(n.vencimiento) : '–'}</td>
      <td style="color:var(--green);font-weight:600">${fmtMoney(n.monto)}</td>
      <td>
        ${cobrarBtn}
        <button class="action-btn" onclick="openEdit('ingreso',${jsLitId(n.id)})" title="Editar">✏️</button>
        <button class="action-btn" onclick="deleteItem('ingreso',${jsLitId(n.id)})" title="Eliminar">🗑️</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:24px">Sin ventas en este período. Cargá arriba: Contado (paga ahora) o Crédito (queda por cobrar).</td></tr>';

  document.getElementById('ing-total').textContent = fmtMoney(data.reduce((s,x) => s + x.monto, 0));
  const porCobrarEl = document.getElementById('ing-por-cobrar');
  if (porCobrarEl) {
    porCobrarEl.textContent = fmtMoney(data.filter(isCreditoPendiente).reduce((s,x) => s + normalizeIngreso(x).saldo, 0));
  }
}

// ── RENDER EGRESOS TABLE ───────────────────────────────
function renderEgresos() {
  const search = (document.getElementById('egr-search')?.value || '').toLowerCase();
  const catF   = document.getElementById('egr-filter-cat')?.value || '';
  let data = egresosFiltrados().filter(x =>
    (!search || x.desc.toLowerCase().includes(search) || (x.proveedor||'').toLowerCase().includes(search)) &&
    (!catF || x.cat === catF)
  ).sort((a,b) => b.fecha.localeCompare(a.fecha));

  const tbody = document.getElementById('egresos-tbody');
  if (!tbody) return;
  tbody.innerHTML = data.length ? data.map(x => `
    <tr>
      <td>${fmtDate(x.fecha)}</td>
      <td>${escapeHtml(x.desc)}</td>
      <td><span class="badge badge-expense">${escapeHtml(x.cat)}</span></td>
      <td>${escapeHtml(x.proveedor||'–')}</td>
      <td style="color:var(--red);font-weight:600">${fmtMoney(x.monto)}</td>
      <td>
        <button class="action-btn" onclick="openEdit('egreso',${jsLitId(x.id)})" title="Editar">✏️</button>
        <button class="action-btn" onclick="deleteItem('egreso',${jsLitId(x.id)})" title="Eliminar">🗑️</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>';

  document.getElementById('egr-total').textContent = fmtMoney(data.reduce((s,x) => s + x.monto, 0));
}

// ── GASTOS FIJOS ────────────────────────────────────────

/** Devuelve el costo mensual de todos los gastos fijos activos */
function costoFijoMensual() {
  return gastosFijos
    .filter(g => g.activo)
    .reduce((s, g) => s + (g.frec === 'anual' ? g.monto / 12 : g.monto), 0);
}

function addGastoFijo() {
  const desc  = document.getElementById('gf-desc').value.trim();
  const cat   = document.getElementById('gf-cat').value;
  const frec  = document.getElementById('gf-frec').value;
  const monto = parseFloat(document.getElementById('gf-monto').value);
  if (!desc || !monto || monto <= 0) { showToast('⚠️ Completá descripción y monto'); return; }
  gastosFijos.push({ id: nextId(), desc, cat, frec, monto, activo: true });
  save(); refreshAll();
  document.getElementById('gf-desc').value  = '';
  document.getElementById('gf-monto').value = '';
  showToast('🔒 Gasto fijo registrado');
}

function toggleGastoFijo(id) {
  const g = gastosFijos.find(x => sameId(x.id, id));
  if (g) { g.activo = !g.activo; save(); refreshAll(); }
}

function deleteGastoFijo(id) {
  if (!confirm('¿Eliminar este gasto fijo?')) return;
  gastosFijos = gastosFijos.filter(x => !sameId(x.id, id));
  save(); refreshAll(); showToast('🗑️ Gasto fijo eliminado');
}

function renderGastosFijos() {
  const tbody = document.getElementById('gf-tbody');
  if (!tbody) return;
  const totalMes  = costoFijoMensual();
  const totalAnual = totalMes * 12;

  if (document.getElementById('gf-total-mes'))     document.getElementById('gf-total-mes').textContent     = fmtMoney(totalMes);
  if (document.getElementById('gf-total-display')) document.getElementById('gf-total-display').textContent = fmtMoney(totalMes);
  if (document.getElementById('gf-total-anual'))   document.getElementById('gf-total-anual').textContent   = fmtMoney(totalAnual);

  tbody.innerHTML = gastosFijos.length ? gastosFijos.map(g => {
    const cMes = g.frec === 'anual' ? g.monto / 12 : g.monto;
    return `<tr style="${g.activo ? '' : 'opacity:0.45'}">
      <td>${escapeHtml(g.desc)}</td>
      <td><span class="badge badge-fixed">${escapeHtml(g.cat)}</span></td>
      <td>${g.frec === 'anual' ? '📅 Anual' : '🔁 Mensual'}</td>
      <td>${fmtMoney(g.monto)}</td>
      <td style="color:var(--orange);font-weight:600">${fmtMoney(cMes)}</td>
      <td>
        <button class="toggle-btn ${g.activo ? 'active' : 'inactive'}" onclick="toggleGastoFijo(${jsLitId(g.id)})">
          ${g.activo ? '✅ Activo' : '⏸ Inactivo'}
        </button>
      </td>
      <td>
        <button class="action-btn" onclick="deleteGastoFijo(${jsLitId(g.id)})" title="Eliminar">🗑️</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin gastos fijos registrados</td></tr>';
}

// ── DASHBOARD ──────────────────────────────────────────
let chartFlujo = null, chartEgrDist = null, chartRent = null;

function refreshDashboard() {
  const ingList = ingresosFiltrados();
  const egrList = egresosFiltrados();
  const totalIng  = ingList.reduce((s,x) => s + x.monto, 0);
  const totalEgr  = egrList.reduce((s,x)  => s + x.monto, 0);
  const totalGF   = gastosFijosEnPeriodo();
  const totalCostos = totalEgr + totalGF;
  const ganancia  = totalIng - totalCostos;
  const margen    = totalIng > 0 ? ((ganancia / totalIng) * 100).toFixed(1) : 0;
  const rango = periodLabel();

  const pendientes = ingresos.filter(isCreditoPendiente);
  const vencidos = pendientes.filter(isCreditoVencido);
  const porCobrar = pendientes.reduce((s,x) => s + normalizeIngreso(x).saldo, 0);
  const cobradoPeriodo = ingresos.reduce((s, x) => {
    return s + pagosDeIngreso(x).filter(p => inPeriodo(p.fecha)).reduce((a, p) => a + Number(p.monto || 0), 0);
  }, 0);

  document.getElementById('kpi-ingresos').textContent = fmtMoney(totalIng);
  document.getElementById('kpi-ingresos-mes').textContent = `${rango} · Ventas (devengado) · Caja cobrada: ${fmtMoney(cobradoPeriodo)}`;
  document.getElementById('kpi-egresos').textContent  = fmtMoney(totalCostos);
  document.getElementById('kpi-egresos-mes').textContent = `Variables: ${fmtMoney(totalEgr)} · Fijos prorrateados: ${fmtMoney(totalGF)}`;
  document.getElementById('kpi-ganancia').textContent = fmtMoney(ganancia);
  document.getElementById('kpi-margen').textContent = `Margen neto: ${margen}%`;

  const estadoEl = document.getElementById('kpi-estado');
  estadoEl.textContent = fmtMoney(porCobrar);
  estadoEl.className = 'kpi-value status-text';
  const resEl = document.getElementById('kpi-resultado');
  if (resEl) {
    resEl.textContent = vencidos.length
      ? `${vencidos.length} vencido${vencidos.length > 1 ? 's' : ''} · Administrar`
      : (pendientes.length ? 'Cartera al día · Administrar' : 'Sin créditos abiertos');
  }

  if (currentUser && currentUser.role === 'contabilidad') {
    const ganEl = document.getElementById('kpi-ganancia');
    const marEl = document.getElementById('kpi-margen');
    if (ganEl) ganEl.textContent = 'Confidencial';
    if (marEl) marEl.textContent = 'Visible para Administración / Admin';
  }

  const all = [
    ...ingList.map(x => ({...x, tipo:'ingreso'})),
    ...egrList.map(x  => ({...x, tipo:'egreso'}))
  ].sort((a,b) => b.fecha.localeCompare(a.fecha)).slice(0,8);

  renderCobranzas(pendientes, vencidos, porCobrar);

  document.getElementById('recent-count').textContent = (ingList.length + egrList.length) + ' en ' + rango;
  document.getElementById('recent-tbody').innerHTML = all.map(x => `
    <tr>
      <td>${fmtDate(x.fecha)}</td>
      <td>${escapeHtml(x.desc)}</td>
      <td><span class="badge ${x.tipo==='ingreso'?'badge-income':'badge-expense'}">${x.tipo==='ingreso' ? (normalizeIngreso(x).cobro==='credito' ? 'Venta crédito' : 'Venta contado') : 'Egreso'}</span></td>
      <td style="color:${x.tipo==='ingreso'?'var(--green)':'var(--red)'};font-weight:600">${x.tipo==='ingreso'?'+':'-'}${fmtMoney(x.monto)}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:24px">Sin registros aún</td></tr>';

  // Charts
  buildFlujoCaja();
  buildEgresosDist();
}

function renderCobranzas(pendientes, vencidos, porCobrar) {
  const tbody = document.getElementById('cobranzas-tbody');
  const count = document.getElementById('cobranzas-count');
  const card = document.getElementById('cobranzas-card');
  if (!tbody) return;
  if (count) count.textContent = `${pendientes.length} · ${fmtMoney(porCobrar)}` + (vencidos.length ? ` · ${vencidos.length} vencidos` : '');
  if (card) card.style.display = 'block';
  const rows = pendientes.slice().sort((a,b) => normalizeIngreso(a).vencimiento.localeCompare(normalizeIngreso(b).vencimiento));
  tbody.innerHTML = rows.length ? rows.map(x => {
    const n = normalizeIngreso(x);
    const late = isCreditoVencido(n);
    return `<tr>
      <td>${escapeHtml(n.cliente||'–')}</td>
      <td>${escapeHtml(n.desc)}</td>
      <td>${fmtDate(n.vencimiento)}</td>
      <td>${late ? '<span class="badge badge-overdue">Vencido</span>' : '<span class="badge badge-credit">A vencer</span>'}</td>
      <td style="color:var(--gold);font-weight:600">${fmtMoney(n.saldo)}</td>
      <td><button class="btn-cobrar" onclick="openCobroModal(${jsLitId(n.id)})">Cobrar</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">No hay créditos pendientes. Cargá una venta tipo Crédito en Ventas o en Por cobrar.</td></tr>';
}

function cobrosEnMes(yyyyMm) {
  return ingresos.reduce((s, x) => {
    return s + pagosDeIngreso(x).filter(p => (p.fecha || '').startsWith(yyyyMm)).reduce((a, p) => a + Number(p.monto || 0), 0);
  }, 0);
}

function buildFlujoCaja() {
  const months = last12Months();
  const ingData = months.map(m => cobrosEnMes(m));
  const egrData = months.map(m => egresos.filter(x => x.fecha.startsWith(m)).reduce((s,x)=>s+x.monto,0));
  const labels  = months.map(m => { const [y,mo]=m.split('-'); return new Date(y,mo-1).toLocaleDateString('es-AR',{month:'short',year:'2-digit'}); });

  const ctx = document.getElementById('chartFlujo');
  if (!ctx) return;
  if (chartFlujo) chartFlujo.destroy();
  chartFlujo = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Cobrado', data: ingData, backgroundColor:'rgba(63,185,80,0.7)', borderColor:'#3fb950', borderWidth:1, borderRadius:4 },
        { label:'Egresos',  data: egrData, backgroundColor:'rgba(248,81,73,0.7)',  borderColor:'#f85149', borderWidth:1, borderRadius:4 }
      ]
    },
    options: chartOpts('$')
  });
}

function buildEgresosDist() {
  const cats = {};
  egresosFiltrados().forEach(x => { cats[x.cat] = (cats[x.cat]||0) + x.monto; });
  const labels = Object.keys(cats);
  const data   = Object.values(cats);

  const ctx = document.getElementById('chartEgresos');
  if (!ctx) return;
  if (chartEgrDist) chartEgrDist.destroy();
  if (!labels.length) return;

  chartEgrDist = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: ['#3fb950','#f85149','#58a6ff','#d29922','#a371f7','#39d353','#ff7b72','#79c0ff','#ffa657'], borderWidth:0 }]
    },
    options: { responsive:true, plugins:{ legend:{ position:'bottom', labels:{ color:'#8b949e', font:{size:11}, padding:12 }}, tooltip:{ callbacks:{ label: c => ` ${c.label}: ${fmtMoney(c.raw)}` }}}}
  });
}

// ── RENTABILIDAD ───────────────────────────────────────
function refreshRentabilidad() {
  const months  = last12Months();
  const gfMes   = costoFijoMensual();
  const ingList = ingresosFiltrados();
  const egrList = egresosFiltrados();
  const ingPeriodo = ingList.reduce((s,x)=>s+x.monto,0);
  const egrPeriodo = egrList.reduce((s,x)=>s+x.monto,0);
  const gfPeriodo  = gastosFijosEnPeriodo();
  const costoTotal = egrPeriodo + gfPeriodo;
  const neto    = ingPeriodo - costoTotal;
  const margen  = ingPeriodo > 0 ? ((neto/ingPeriodo)*100).toFixed(1) : 0;

  document.getElementById('rent-ingresos').textContent = fmtMoney(ingPeriodo);
  document.getElementById('rent-egresos').textContent  = fmtMoney(costoTotal);
  document.getElementById('rent-neto').textContent     = fmtMoney(neto);
  document.getElementById('rent-margen').textContent   = margen + '%';
  const rentHint = document.getElementById('rent-period-hint');
  if (rentHint) rentHint.textContent = 'Recuadros: ' + periodLabel() + '. Tabla y gráfico: últimos 12 meses calendario.';

  const rows = months.map(m => {
    const ing = ingresos.filter(x=>x.fecha.startsWith(m)).reduce((s,x)=>s+x.monto,0);
    const egr = egresos.filter(x=>x.fecha.startsWith(m)).reduce((s,x)=>s+x.monto,0);
    const gf  = gfMes;
    const costoMes = egr + gf;
    const res = ing - costoMes;
    const mg  = ing > 0 ? ((res/ing)*100).toFixed(1) : '–';
    const [y,mo] = m.split('-');
    const label = new Date(y,mo-1).toLocaleDateString('es-AR',{month:'long',year:'numeric'});
    return { label, ing, egr, gf, costoMes, res, mg };
  });

  document.getElementById('rent-tbody').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td style="color:var(--green)">${fmtMoney(r.ing)}</td>
      <td style="color:var(--red)">${fmtMoney(r.egr)}</td>
      <td style="color:var(--orange)">${fmtMoney(r.gf)}</td>
      <td style="color:var(--red)">${fmtMoney(r.costoMes)}</td>
      <td class="${r.res>=0?'positive':'negative'}">${fmtMoney(r.res)}</td>
      <td class="${r.res>=0?'positive':'negative'}">${r.mg !== '–' ? r.mg+'%' : '–'}</td>
    </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin datos</td></tr>';

  // Chart
  const labels  = rows.map(r => r.label.split(' ')[0]);
  const ingData = rows.map(r => r.ing);
  const egrData = rows.map(r => r.egr);
  const resData = rows.map(r => r.res);

  const ctx = document.getElementById('chartRentabilidad');
  if (!ctx) return;
  if (chartRent) chartRent.destroy();
  chartRent = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Ingresos',  data: ingData, borderColor:'#3fb950', backgroundColor:'rgba(63,185,80,0.1)',  fill:true, tension:0.4, pointRadius:4 },
        { label:'Egresos',   data: egrData, borderColor:'#f85149', backgroundColor:'rgba(248,81,73,0.1)',  fill:true, tension:0.4, pointRadius:4 },
        { label:'Resultado', data: resData, borderColor:'#58a6ff', backgroundColor:'rgba(88,166,255,0.1)', fill:true, tension:0.4, pointRadius:4 }
      ]
    },
    options: chartOpts('$')
  });
}

// ── REPORTES ───────────────────────────────────────────
function refreshReportes() {
  const ingList = ingresosFiltrados();
  const egrList = egresosFiltrados();
  const totalIng  = ingList.reduce((s,x)=>s+x.monto,0);
  const totalEgr  = egrList.reduce((s,x)=>s+x.monto,0);
  const totalGF   = gastosFijosEnPeriodo();
  const totalCostos = totalEgr + totalGF;
  const neto      = totalIng - totalCostos;
  const margen    = totalIng > 0 ? ((neto/totalIng)*100).toFixed(1) : 0;
  const dateEl = document.getElementById('report-date');
  if (dateEl) dateEl.textContent = 'Período: ' + periodLabel() + ' · Generado: ' + new Date().toLocaleDateString('es-AR');

  const cats = {};
  egrList.forEach(x => { cats[x.cat] = (cats[x.cat]||0) + x.monto; });
  const gfCats = gastosFijosPorCategoriaEnPeriodo();

  let rows = `
    <tr><td><strong>TOTAL INGRESOS</strong></td><td style="color:var(--green);font-weight:700">${fmtMoney(totalIng)}</td></tr>
    <tr><td><strong>Egresos Variables</strong></td><td style="color:var(--red)">${fmtMoney(totalEgr)}</td></tr>
    <tr><td><strong>Gastos fijos (prorrateados al período)</strong></td><td style="color:var(--orange)">${fmtMoney(totalGF)}</td></tr>
    <tr><td><strong>TOTAL COSTOS</strong></td><td style="color:var(--red);font-weight:700">${fmtMoney(totalCostos)}</td></tr>
    <tr style="border-top:2px solid var(--border)">
      <td><strong>RESULTADO NETO</strong></td>
      <td class="${neto>=0?'positive':'negative'}" style="font-size:16px;font-weight:800">${fmtMoney(neto)}</td>
    </tr>
    <tr><td>Margen Neto</td><td class="${neto>=0?'positive':'negative'}">${margen}%</td></tr>
    <tr><td colspan="2" style="padding-top:16px;font-weight:700;color:var(--text2)">DESGLOSE EGRESOS VARIABLES</td></tr>
  `;
  Object.entries(cats).forEach(([k,v]) => {
    rows += `<tr><td style="padding-left:16px">– ${escapeHtml(k)}</td><td>${fmtMoney(v)}</td></tr>`;
  });
  if (Object.keys(gfCats).length) {
    rows += `<tr><td colspan="2" style="padding-top:16px;font-weight:700;color:var(--text2)">DESGLOSE GASTOS FIJOS</td></tr>`;
    Object.entries(gfCats).forEach(([k,v]) => {
      rows += `<tr><td style="padding-left:16px">🔒 ${escapeHtml(k)}</td><td style="color:var(--orange)">${fmtMoney(v)}</td></tr>`;
    });
  }

  document.getElementById('report-tbody').innerHTML = rows;
}

function csvCell(value) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

function exportCSV() {
  let csv = 'Tipo,Fecha,Descripción,Categoría,Detalle,Monto,Cobro,Plazo,Vencimiento,EstadoCobro,FechaCobro,VentaId,Nota\n';
  ingresos.forEach(x => {
    const n = normalizeIngreso(x);
    csv += ['Ingreso', n.fecha, n.desc, n.cat, n.cliente || '', n.monto, n.cobro, n.plazo || '', n.vencimiento || '', n.estadoCobro, n.fechaCobro || '', n.id, ''].map(csvCell).join(',') + '\n';
    pagosDeIngreso(n).forEach(p => {
      csv += ['Cobro', p.fecha, n.desc, n.cat, n.cliente || '', p.monto, n.cobro, '', '', '', '', n.id, p.nota || ''].map(csvCell).join(',') + '\n';
    });
  });
  egresos.forEach(x => {
    csv += ['Egreso variable', x.fecha, x.desc, x.cat, x.proveedor || '', x.monto, '', '', '', '', '', x.id, ''].map(csvCell).join(',') + '\n';
  });
  gastosFijos.filter(g => g.activo).forEach(g => {
    const cMes = g.frec === 'anual' ? (g.monto / 12) : g.monto;
    csv += ['Gasto fijo', 'mensual', g.desc, g.cat, g.frec, cMes, '', '', '', '', '', g.id, ''].map(csvCell).join(',') + '\n';
  });
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AGROTRIAL_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  showToast('CSV exportado');
}

// ── REFRESH ALL ────────────────────────────────────────
function refreshAll() {
  renderIngresos();
  renderEgresos();
  renderGastosFijos();
  refreshDashboard();
  refreshRentabilidad();
  refreshReportes();
  renderSugerencias();
  renderUsuarios();
  renderPorCobrar();
}

function agingBucket(x) {
  const dias = diasHastaVencimiento(x);
  if (dias >= 0) return 'aldia';
  if (dias >= -30) return 'd30';
  if (dias >= -60) return 'd60';
  return 'd90';
}

function renderPorCobrar() {
  const tbody = document.getElementById('pc-tbody');
  if (!tbody) return;
  const creditos = ingresos.map(normalizeIngreso).filter(x => x.cobro === 'credito');
  const abiertos = creditos.filter(x => x.saldo > 0.009);
  const vencidos = abiertos.filter(isCreditoVencido);
  const en7 = abiertos.filter(x => {
    const d = diasHastaVencimiento(x);
    return d >= 0 && d <= 7;
  });
  const cobradoPeriodo = ingresos.reduce((s, x) => {
    const n = normalizeIngreso(x);
    if (n.cobro !== 'credito') return s;
    return s + pagosDeIngreso(x).filter(p => inPeriodo(p.fecha)).reduce((a, p) => a + Number(p.monto || 0), 0);
  }, 0);
  const saldoAbierto = abiertos.reduce((s, x) => s + x.saldo, 0);

  document.getElementById('pc-total').textContent = fmtMoney(saldoAbierto);
  document.getElementById('pc-total-sub').textContent = abiertos.length + ' créditos abiertos';
  document.getElementById('pc-vencido').textContent = fmtMoney(vencidos.reduce((s, x) => s + x.saldo, 0));
  document.getElementById('pc-vencido-sub').textContent = vencidos.length + ' fuera de plazo';
  document.getElementById('pc-7d').textContent = fmtMoney(en7.reduce((s, x) => s + x.saldo, 0));
  document.getElementById('pc-cobrado').textContent = fmtMoney(cobradoPeriodo);
  document.getElementById('pc-cobrado-sub').textContent = periodLabel();

  const aging = { aldia: 0, d30: 0, d60: 0, d90: 0 };
  abiertos.forEach(x => { aging[agingBucket(x)] += x.saldo; });
  document.getElementById('pc-aging').innerHTML = [
    ['Al día', aging.aldia],
    ['1–30 días vencido', aging.d30],
    ['31–60 días', aging.d60],
    ['Más de 60 días', aging.d90]
  ].map(([label, val], i) => `
    <div class="aging-chip ${i && val ? 'warn' : ''}">
      <div class="aging-label">${label}</div>
      <div class="aging-value">${fmtMoney(val)}</div>
    </div>`).join('');

  const byClient = {};
  abiertos.forEach(x => {
    const k = x.cliente || 'Sin cliente';
    if (!byClient[k]) byClient[k] = { n: 0, saldo: 0, vencido: 0 };
    byClient[k].n += 1;
    byClient[k].saldo += x.saldo;
    if (isCreditoVencido(x)) byClient[k].vencido += x.saldo;
  });
  const cliRows = Object.entries(byClient).sort((a, b) => b[1].saldo - a[1].saldo);
  document.getElementById('pc-clientes-tbody').innerHTML = cliRows.length ? cliRows.map(([name, v]) => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td>${v.n}</td>
      <td style="font-weight:600">${fmtMoney(v.saldo)}</td>
      <td style="color:${v.vencido ? 'var(--red)' : 'var(--text2)'}">${fmtMoney(v.vencido)}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:16px">No hay saldos abiertos</td></tr>';

  const search = (document.getElementById('pc-search')?.value || '').toLowerCase();
  const estadoF = document.getElementById('pc-filter-estado')?.value || 'abiertos';
  let list = creditos.filter(n => {
    const text = !search || (n.cliente || '').toLowerCase().includes(search) || n.desc.toLowerCase().includes(search);
    if (!text) return false;
    if (estadoF === 'abiertos') return n.saldo > 0.009;
    if (estadoF === 'vencido') return isCreditoVencido(n);
    if (estadoF === 'aldia') return n.saldo > 0.009 && !isCreditoVencido(n);
    if (estadoF === 'parcial') return n.estadoCobro === 'parcial';
    if (estadoF === 'cobrado') return n.estadoCobro === 'cobrado';
    return true;
  }).sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));

  document.getElementById('pc-list-count').textContent = list.length + ' registros';
  tbody.innerHTML = list.length ? list.map(n => {
    const acciones = n.saldo > 0.009 ? `
      <button class="btn-cobrar" onclick="openCobroModal(${jsLitId(n.id)})">Cobrar</button>
      <button class="btn-cobrar" onclick="openProrrogaModal(${jsLitId(n.id)})">Prorrogar</button>` : '';
    return `<tr>
      <td>${escapeHtml(n.cliente || '–')}</td>
      <td>${fmtDate(n.fecha)} · ${escapeHtml(n.desc)}</td>
      <td>${fmtDate(n.vencimiento)}</td>
      <td>${cobroBadge(n)}</td>
      <td>${fmtMoney(n.monto)}</td>
      <td style="font-weight:700;color:${n.saldo ? 'var(--gold)' : 'var(--green)'}">${fmtMoney(n.saldo)}</td>
      <td>${acciones}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">No hay créditos en este filtro</td></tr>';

  const badge = document.getElementById('nav-cobrar-badge');
  if (badge) {
    if (vencidos.length) {
      badge.hidden = false;
      badge.textContent = String(vencidos.length);
    } else {
      badge.hidden = true;
    }
  }
}

// ── SUGERENCIAS ─────────────────────────────────────────
const ESTADO_SUG = {
  pendiente: 'Pendiente',
  recibida: 'Recibida',
  proceso: 'En proceso',
  hecha: 'Hecha'
};

function addSugerencia() {
  const nombre    = document.getElementById('sug-nombre').value.trim();
  const desc      = document.getElementById('sug-desc').value.trim();
  const cat       = document.getElementById('sug-cat').value;
  const prioridad = document.getElementById('sug-prioridad').value;
  if (!nombre) { showToast('Ingresá el nombre del módulo'); return; }
  sugerencias.push({
    id: nextId(),
    nombre,
    desc,
    cat,
    prioridad,
    estado: 'pendiente',
    autor: currentUser ? currentUser.name : 'Usuario',
    autorId: currentUser ? currentUser.id : '',
    fecha: toISODate(new Date())
  });
  save();
  document.getElementById('sug-nombre').value = '';
  document.getElementById('sug-desc').value   = '';
  renderSugerencias();
  showToast('Sugerencia enviada al administrador');
}

function setEstadoSugerencia(id, estado) {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('Solo el administrador puede recepcionar sugerencias');
    return;
  }
  const s = sugerencias.find(x => sameId(x.id, id));
  if (!s) return;
  s.estado = estado;
  save();
  renderSugerencias();
  showToast('Estado actualizado: ' + ESTADO_SUG[estado]);
}

function deleteSugerencia(id) {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('Solo el administrador puede quitar sugerencias de la bandeja');
    return;
  }
  sugerencias = sugerencias.filter(x => !sameId(x.id, id));
  save();
  renderSugerencias();
}

const PRIORIDAD_LABEL = { alta: 'Alta', media: 'Media', baja: 'Baja' };

function sugCardHtml(s, admin) {
  const estado = s.estado || 'pendiente';
  const actions = admin ? `
    <div class="sug-card-vote">
      <button class="vote-btn" onclick="setEstadoSugerencia(${jsLitId(s.id)}, 'recibida')">Recibir</button>
      <button class="vote-btn" onclick="setEstadoSugerencia(${jsLitId(s.id)}, 'proceso')">En proceso</button>
      <button class="vote-btn" onclick="setEstadoSugerencia(${jsLitId(s.id)}, 'hecha')">Hecha</button>
      <button class="action-btn" onclick="deleteSugerencia(${jsLitId(s.id)})" title="Quitar">✕</button>
    </div>` : `
    <div class="sug-card-vote">
      <div class="sug-estado sugerido">${ESTADO_SUG[estado] || estado}</div>
    </div>`;
  return `
    <div class="sug-card user-sug">
      <div class="sug-card-body">
        <div class="sug-card-name">${escapeHtml(s.nombre)}</div>
        <div class="sug-card-desc">${escapeHtml(s.desc || 'Sin descripción')}</div>
        <div class="sug-card-meta">
          <span class="badge badge-fixed">${escapeHtml(s.cat)}</span>
          <span class="badge" style="background:rgba(255,255,255,0.05);color:var(--text2)">${escapeHtml(PRIORIDAD_LABEL[s.prioridad]||'')}</span>
          <span style="font-size:11px;color:var(--text2)">${escapeHtml(s.autor || '')} · ${escapeHtml(s.fecha || '')}</span>
        </div>
      </div>
      ${actions}
    </div>`;
}

function renderSugerencias() {
  const inbox = document.getElementById('sug-inbox');
  const inboxTitle = document.getElementById('sug-inbox-title');
  const userList = document.getElementById('sug-user-list');
  const userTitle = document.getElementById('sug-user-title');
  const formCard = document.getElementById('sug-form-card');
  const heroTitle = document.getElementById('sug-hero-title');
  const heroSub = document.getElementById('sug-hero-sub');
  const navLabel = document.getElementById('nav-sug-label');
  if (!inbox || !userList) return;

  const isAdmin = currentUser && currentUser.role === 'admin';
  if (navLabel) navLabel.textContent = isAdmin ? 'Bandeja' : 'Enviar sugerencia';
  if (heroTitle) heroTitle.textContent = isAdmin ? 'Bandeja de sugerencias' : 'Enviar sugerencia';
  if (heroSub) heroSub.textContent = isAdmin
    ? 'Recepcioná las propuestas del equipo y actualizá su estado.'
    : 'El administrador recibe tus propuestas y las gestiona desde su bandeja.';
  if (formCard) formCard.style.display = isAdmin ? 'none' : 'block';

  if (isAdmin) {
    inboxTitle.style.display = 'block';
    userTitle.style.display = 'none';
    userList.innerHTML = '';
    inbox.innerHTML = sugerencias.length
      ? sugerencias.slice().sort((a,b) => String(b.fecha).localeCompare(String(a.fecha))).map(s => sugCardHtml(s, true)).join('')
      : '<p style="color:var(--text2);font-size:13px">No hay sugerencias todavía.</p>';
  } else {
    inboxTitle.style.display = 'none';
    inbox.innerHTML = '';
    const mias = sugerencias.filter(s => currentUser && s.autorId === currentUser.id);
    if (mias.length) {
      userTitle.style.display = 'block';
      userList.innerHTML = mias.map(s => sugCardHtml(s, false)).join('');
    } else {
      userTitle.style.display = 'none';
      userList.innerHTML = '';
    }
  }
}

// ── HELPERS ────────────────────────────────────────────
function fmtMoney(n) {
  return new Intl.NumberFormat('es-AR', { style:'currency', currency:'ARS', minimumFractionDigits:0 }).format(n||0);
}
function fmtDate(d) {
  if (!d) return '';
  const [y,m,day] = d.split('-');
  return `${day}/${m}/${y}`;
}
function last12Months() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return months;
}
function chartOpts(prefix) {
  return {
    responsive: true,
    plugins: {
      legend: { labels: { color:'#8b949e', font:{size:11} } },
      tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtMoney(c.raw)}` } }
    },
    scales: {
      x: { ticks:{ color:'#8b949e', font:{size:11} }, grid:{ color:'rgba(255,255,255,0.04)' } },
      y: { ticks:{ color:'#8b949e', font:{size:11}, callback: v => '$'+v.toLocaleString('es-AR') }, grid:{ color:'rgba(255,255,255,0.04)' } }
    }
  };
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── SISTEMA MULTI-ROL Y PERMISOS ───────────────────────

function applyUserRolePermissions() {
  const config = ROLES_CONFIG[currentUser ? currentUser.role : 'administracion'] || ROLES_CONFIG.administracion;

  // Actualizar topbar
  const topAvatar = document.getElementById('topbar-user-avatar');
  const topName   = document.getElementById('topbar-user-name');
  const topBadge  = document.getElementById('topbar-user-badge');
  if (topAvatar) topAvatar.textContent = currentUser.avatar || '👤';
  if (topName)   topName.textContent   = currentUser.name;
  if (topBadge) {
    topBadge.textContent = config.badge;
    topBadge.className = `badge ${config.badgeClass}`;
  }

  // Actualizar sidebar card
  const sideAvatar = document.getElementById('sidebar-user-avatar');
  const sideName   = document.getElementById('sidebar-user-name');
  const sideRole   = document.getElementById('sidebar-user-role');
  if (sideAvatar) sideAvatar.textContent = currentUser.avatar || '👤';
  if (sideName)   sideName.textContent   = currentUser.name;
  if (sideRole)   sideRole.textContent   = config.title;

  const navSug = document.getElementById('nav-sug-label');
  if (navSug) navSug.textContent = currentUser.role === 'admin' ? 'Bandeja' : 'Enviar sugerencia';

  const cloudBtn = document.getElementById('btn-cloud');
  if (cloudBtn) cloudBtn.style.display = currentUser.role === 'admin' ? 'flex' : 'none';

  // Filtrar nav items del sidebar según data-roles
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    const rolesAttr = item.getAttribute('data-roles') || '';
    const rolesList = rolesAttr.split(',').map(r => r.trim());
    if (rolesList.includes(currentUser.role)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });

  const esCarga = currentUser.role === 'contabilidad' || currentUser.role === 'operador';
  document.body.classList.toggle('role-carga', esCarga);
  if (esCarga) {
    document.querySelectorAll('#page-dashboard .kpi-card.profit').forEach(el => { el.style.display = 'none'; });
  } else {
    document.querySelectorAll('#page-dashboard .kpi-card.profit').forEach(el => { el.style.display = ''; });
  }

  // Si la página actual no está permitida, redirigir a la página default del rol
  const activePageEl = document.querySelector('.page.active');
  const currentActivePage = activePageEl ? activePageEl.id.replace('page-', '') : 'dashboard';
  if (!config.allowedPages.includes(currentActivePage)) {
    showPage(config.defaultPage);
  }
}

function showLoginScreen() {
  const screen = document.getElementById('login-screen');
  const appWrapper = document.getElementById('app-wrapper');
  if (screen) screen.style.display = 'flex';
  if (appWrapper) appWrapper.style.display = 'none';
  const userInp = document.getElementById('role-login-user');
  const passInp = document.getElementById('role-login-pass');
  if (userInp) userInp.value = '';
  if (passInp) passInp.value = '';
  const setup = document.getElementById('setup-step-form');
  const login = document.getElementById('login-step-form');
  const needsSetup = !usuarios.length;
  if (setup) setup.hidden = !needsSetup;
  if (login) login.hidden = needsSetup;
}

function showAppLayout() {
  const screen = document.getElementById('login-screen');
  const appWrapper = document.getElementById('app-wrapper');
  if (screen) screen.style.display = 'none';
  if (appWrapper) appWrapper.style.display = 'flex';
}

async function handleFirstAdmin(e) {
  e.preventDefault();
  const name = document.getElementById('setup-name').value.trim();
  const email = document.getElementById('setup-email').value.trim().toLowerCase();
  const pass = document.getElementById('setup-pass').value;
  const pass2 = document.getElementById('setup-pass2').value;
  if (!name || !email || !email.includes('@')) {
    showToast('Completá nombre y correo');
    return;
  }
  if (pass.length < 8) {
    showToast('La contraseña debe tener al menos 8 caracteres');
    return;
  }
  if (pass !== pass2) {
    showToast('Las contraseñas no coinciden');
    return;
  }
  if (!window.crypto || !crypto.subtle) {
    showToast('Este navegador no puede guardar la clave de forma segura (hace falta HTTPS)');
    return;
  }
  const admin = {
    id: 'u_admin',
    name,
    email,
    role: 'admin',
    active: true,
    avatar: '🛡️'
  };
  await setUserPassword(admin, pass);
  usuarios = [admin];
  await persistDB();
  persistSession(admin);
  showAppLayout();
  applyUserRolePermissions();
  refreshAll();
  showPage(ROLES_CONFIG.admin.defaultPage);
  showToast('Administrador creado');
}

async function handleLogin(e) {
  e.preventDefault();
  const userInput = document.getElementById('role-login-user').value.trim().toLowerCase();
  const passInput  = document.getElementById('role-login-pass').value;

  const user = usuarios.find(u =>
    u.email.toLowerCase() === userInput || u.name.toLowerCase() === userInput
  );

  if (!user || !(await verifyUserPassword(user, passInput))) {
    showToast('Usuario o contraseña incorrectos');
    return;
  }
  if (!user.active) {
    showToast('Este usuario está desactivado');
    return;
  }

  persistSession(user);
  showAppLayout();
  applyUserRolePermissions();
  refreshAll();

  const config = ROLES_CONFIG[user.role] || ROLES_CONFIG.administracion;
  showPage(config.defaultPage);
  showToast('Sesión iniciada');
}

function logout() {
  sessionStorage.removeItem('agrotrial_session_user');
  currentUser = null;
  showLoginScreen();
  showToast('Sesión cerrada');
}

// ── RESETEO DE CONTRASEÑAS (ADMIN) ────────────────────

let targetResetUserId = null;

function openResetPasswordModal(userId) {
  const user = usuarios.find(u => u.id === userId);
  if (!user) return;
  targetResetUserId = userId;
  const targetLabel = document.getElementById('reset-target-user');
  const inputEl     = document.getElementById('reset-new-pass');
  if (targetLabel) targetLabel.textContent = `${user.name} (${user.email})`;
  if (inputEl) { inputEl.value = ''; inputEl.focus(); }
  document.getElementById('modal-reset-pass').classList.add('open');
}

function closeResetPassModal() {
  document.getElementById('modal-reset-pass').classList.remove('open');
  targetResetUserId = null;
}

async function confirmResetPassword() {
  const newPass = document.getElementById('reset-new-pass').value;
  if (!newPass || newPass.length < 8) {
    showToast('La contraseña debe tener al menos 8 caracteres');
    return;
  }
  const user = usuarios.find(u => u.id === targetResetUserId);
  if (!user) {
    showToast('Usuario no encontrado');
    return;
  }
  await setUserPassword(user, newPass);
  save();
  closeResetPassModal();
  renderUsuarios();
  showToast('Contraseña actualizada para ' + user.name);
}

// ── GESTIÓN DE USUARIOS (ADMIN) ────────────────────────

async function addUser() {
  const nombre = document.getElementById('usr-nombre').value.trim();
  const email  = document.getElementById('usr-email').value.trim().toLowerCase();
  const role   = document.getElementById('usr-role').value;
  const pass   = document.getElementById('usr-pass').value;

  if (!nombre || !email) {
    showToast('Completá el nombre y el correo');
    return;
  }
  if (pass.length < 8) {
    showToast('La contraseña inicial debe tener al menos 8 caracteres');
    return;
  }

  if (usuarios.some(u => u.email.toLowerCase() === email)) {
    showToast('Ya existe un usuario con ese correo');
    return;
  }

  const avatars = { admin: '🛡️', administracion: '🏛️', contabilidad: '✍️' };
  const user = {
    id: 'u_' + nextId().replace(/-/g, '').slice(0, 16),
    name: nombre,
    email,
    role,
    active: true,
    avatar: avatars[role] || '👤'
  };
  await setUserPassword(user, pass);
  usuarios.push(user);

  save();
  renderUsuarios();
  document.getElementById('usr-nombre').value = '';
  document.getElementById('usr-email').value = '';
  document.getElementById('usr-pass').value = '';
  showToast('Usuario creado');
}

function toggleUserStatus(id) {
  const user = usuarios.find(u => u.id === id);
  if (!user) return;
  if (user.id === currentUser.id) {
    showToast('⚠️ No podés desactivar tu propia cuenta activa');
    return;
  }
  user.active = !user.active;
  save();
  renderUsuarios();
  showToast(`Estado actualizado: ${user.name} ahora está ${user.active ? 'Activo' : 'Inactivo'}`);
}

function deleteUser(id) {
  if (id === currentUser.id) {
    showToast('⚠️ No podés eliminar tu propia cuenta en sesión');
    return;
  }
  if (!confirm('¿Eliminar este usuario definitivamente?')) return;
  usuarios = usuarios.filter(u => u.id !== id);
  save();
  renderUsuarios();
  showToast('🗑️ Usuario eliminado');
}

function renderUsuarios() {
  const tbody = document.getElementById('usuarios-tbody');
  const countEl = document.getElementById('usr-count');
  if (!tbody) return;

  if (countEl) countEl.textContent = `${usuarios.length} usuarios registrados`;

  tbody.innerHTML = usuarios.map(u => {
    const config = ROLES_CONFIG[u.role] || ROLES_CONFIG.administracion;
    return `
      <tr style="${u.active ? '' : 'opacity:0.45'}">
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">${escapeHtml(u.avatar || '👤')}</span>
            <strong>${escapeHtml(u.name)}</strong>
            ${u.id === currentUser.id ? '<span class="badge badge-income" style="font-size:10px;">En sesión</span>' : ''}
          </div>
        </td>
        <td><code>${escapeHtml(u.email)}</code></td>
        <td><span class="badge ${config.badgeClass}">${config.badge}</span></td>
        <td>
          <button class="toggle-btn ${u.active ? 'active' : 'inactive'}" onclick="toggleUserStatus(${jsLitId(u.id)})">
            ${u.active ? '✅ Activo' : '⏸ Inactivo'}
          </button>
        </td>
        <td>
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="action-btn" onclick="openResetPasswordModal(${jsLitId(u.id)})" title="Resetear Contraseña" style="padding: 4px 8px; font-size: 11px; background: rgba(210,153,34,0.15); border: 1px solid rgba(210,153,34,0.4); color: var(--gold); border-radius: 6px; cursor: pointer;">
              🔑 Clave
            </button>
            ${u.id !== currentUser.id ? `<button class="action-btn" onclick="deleteUser(${jsLitId(u.id)})" title="Eliminar">🗑️</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ── NUBE Y SINCRONIZACIÓN ──────────────────────────────

function fillCloudForm() {
  const a = document.getElementById('fb-apikey');
  const p = document.getElementById('fb-project');
  const d = document.getElementById('fb-auth');
  const k = document.getElementById('fb-synckey');
  if (a) a.value = cloudConfig.apiKey || '';
  if (p) p.value = cloudConfig.projectId || '';
  if (d) d.value = cloudConfig.authDomain || '';
  if (k) k.value = cloudConfig.syncKey || '';
}

function openCloudModal() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('Solo el administrador puede gestionar el respaldo');
    return;
  }
  const el = document.getElementById('db-status-text');
  if (el) {
    const saved = lastSaveAt ? (' Último guardado: ' + lastSaveAt.replace('T', ' ').slice(0, 19) + '.') : '';
    el.textContent = dbReady
      ? `IndexedDB activa en este navegador. ${ingresos.length} ingresos, ${egresos.length} egresos, ${gastosFijos.length} gastos fijos, ${usuarios.length} usuarios, ${sugerencias.length} sugerencias.${saved}`
      : 'La base de datos todavía no está lista.';
  }
  fillCloudForm();
  document.getElementById('modal-cloud').classList.add('open');
}

function closeCloudModal() {
  document.getElementById('modal-cloud').classList.remove('open');
}

function buildBackupPayload() {
  return {
    empresa: 'AGROTRIAL',
    version: '2.0',
    exportadoEn: new Date().toISOString(),
    ingresos,
    egresos,
    gastosFijos,
    sugerencias,
    usuarios: usuarios.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      avatar: u.avatar,
      passHash: u.passHash || '',
      passSalt: u.passSalt || ''
    }))
  };
}

function readCloudForm() {
  return {
    apiKey: (document.getElementById('fb-apikey')?.value || '').trim(),
    projectId: (document.getElementById('fb-project')?.value || '').trim(),
    authDomain: (document.getElementById('fb-auth')?.value || '').trim(),
    syncKey: (document.getElementById('fb-synckey')?.value || '').trim().replace(/\//g, '')
  };
}

function generateSyncKey() {
  const key = nextId().replace(/-/g, '') + nextId().replace(/-/g, '');
  const el = document.getElementById('fb-synckey');
  if (el) el.value = key.slice(0, 40);
  showToast('Clave generada. Guardala y copiala en el otro dispositivo.');
}

function saveCloudSettings() {
  cloudConfig = readCloudForm();
  if (!cloudConfig.apiKey || !cloudConfig.projectId || !cloudConfig.syncKey) {
    showToast('Completá apiKey, projectId y la clave de sincronización');
    return;
  }
  if (!cloudConfig.authDomain) cloudConfig.authDomain = cloudConfig.projectId + '.firebaseapp.com';
  save();
  showToast('Conexión de nube guardada en este navegador');
}

function loadFirebaseSdk() {
  if (window.firebase && firebase.firestore) return Promise.resolve();
  const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar Firebase'));
    document.head.appendChild(s);
  });
  return load('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
    .then(() => load('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'));
}

function initFirebaseApp() {
  cloudConfig = { ...cloudConfig, ...readCloudForm() };
  if (!cloudConfig.apiKey || !cloudConfig.projectId || !cloudConfig.syncKey) {
    throw new Error('Falta la conexión de Firebase');
  }
  const cfg = {
    apiKey: cloudConfig.apiKey,
    authDomain: cloudConfig.authDomain || (cloudConfig.projectId + '.firebaseapp.com'),
    projectId: cloudConfig.projectId
  };
  if (!firebase.apps.length) firebase.initializeApp(cfg);
  return firebase.firestore().collection('agrotrial').doc(cloudConfig.syncKey);
}

async function pushToCloud() {
  try {
    await loadFirebaseSdk();
    const ref = initFirebaseApp();
    cloudConfig = readCloudForm();
    await save();
    await ref.set(JSON.parse(JSON.stringify(buildBackupPayload())));
    showToast('Base subida a la nube');
  } catch (err) {
    showToast(err.message || 'No se pudo subir. Revisá el proyecto y las reglas de Firestore.');
  }
}

async function pullFromCloud() {
  try {
    await loadFirebaseSdk();
    const ref = initFirebaseApp();
    const snap = await ref.get();
    if (!snap.exists) {
      showToast('No hay datos en esa clave de sincronización');
      return;
    }
    const parsed = parseBackupPayload(snap.data());
    if (parsed.error) {
      showToast(parsed.error);
      return;
    }
    if (!confirm('Esto reemplaza ingresos, egresos y gastos fijos de este navegador con lo de la nube. ¿Continuar?')) return;
    ingresos = parsed.ingresos;
    egresos = parsed.egresos;
    gastosFijos = parsed.gastosFijos;
    if (parsed.sugerencias) sugerencias = parsed.sugerencias;
    if (parsed.usuarios && parsed.usuarios.length) {
      const replaceUsers = confirm('La nube incluye usuarios. Aceptar = usar esos usuarios. Cancelar = dejar los de este dispositivo.');
      if (replaceUsers) usuarios = parsed.usuarios;
    }
    await save();
    refreshAll();
    showToast('Base bajada de la nube');
  } catch (err) {
    showToast(err.message || 'No se pudo bajar de la nube');
  }
}

function exportDatabaseJSON() {
  const data = buildBackupPayload();

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AGROTRIAL_DATABASE_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  showToast('☁️ Respaldo de Base de Datos descargado');
}

function importDatabaseJSON(e) {
  const input = e.target;
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    showToast('El archivo es demasiado grande');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      let data;
      try {
        data = JSON.parse(evt.target.result);
      } catch {
        showToast('El archivo no es un JSON válido');
        return;
      }
      const parsed = parseBackupPayload(data);
      if (parsed.error) {
        showToast(parsed.error);
        return;
      }
      if (!confirm('Esto reemplaza ingresos, egresos y gastos fijos de este navegador. ¿Continuar?')) return;

      ingresos = parsed.ingresos;
      egresos = parsed.egresos;
      gastosFijos = parsed.gastosFijos;
      if (parsed.sugerencias) sugerencias = parsed.sugerencias;

      if (parsed.usuarios && parsed.usuarios.length) {
        const replaceUsers = confirm('El archivo incluye usuarios. Aceptar = usar esos usuarios. Cancelar = dejar los usuarios de este dispositivo.');
        if (replaceUsers) usuarios = parsed.usuarios;
      }

      save();
      refreshAll();
      closeCloudModal();
      showToast('Respaldo restaurado');
    } catch (err) {
      showToast('No se pudo restaurar el archivo');
    }
  };
  reader.readAsText(file);
}

function runAgrotrialChecks() {
  const fails = [];
  const expect = (ok, msg) => { if (!ok) fails.push(msg); };
  const gfDia = gastosFijosEnRango('2026-10-15', '2026-10-15', [{ activo: true, frec: 'mensual', monto: 3100 }]);
  expect(Math.abs(gfDia - 100) < 0.01, 'prorrateo 1 día de octubre = 100');
  const gfMes = gastosFijosEnRango('2026-10-01', '2026-10-31', [{ activo: true, frec: 'mensual', monto: 3100 }]);
  expect(Math.abs(gfMes - 3100) < 0.01, 'octubre completo = 3100');
  expect(csvCell('a"b') === '"a""b"', 'csv escapa comillas');
  const prev = { id: 1, pagos: [{ fecha: '2026-10-01', monto: 50, nota: 'parcial' }], cobro: 'credito' };
  const edited = applyIngresoEdit(prev, {
    fecha: '2026-10-01', desc: 'Soja', cat: 'Ventas', cliente: 'A', monto: 200, cobro: 'credito', plazo: 30, vencimiento: '2026-10-31'
  });
  expect(edited.pagos.length === 1 && edited.pagos[0].monto === 50, 'editar crédito conserva pagos');
  expect(edited.estadoCobro === 'parcial', 'queda parcial');
  const bad = parseBackupPayload({ ingresos: 'x', egresos: [] });
  expect(!!bad.error, 'import rechaza ingresos inválidos');
  const role = parseBackupPayload({
    ingresos: [{ fecha: '2026-10-01', desc: 'A', monto: 10 }],
    egresos: [{ fecha: '2026-10-01', desc: 'B', monto: 1 }],
    usuarios: [{ id: 'u_x', name: 'X', email: 'a@b.c', role: 'root' }]
  });
  expect(role.usuarios && role.usuarios[0].role === 'contabilidad', 'rol desconocido baja a contabilidad');
  return { ok: fails.length === 0, fails };
}
