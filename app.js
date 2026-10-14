// ── STATE ──────────────────────────────────────────────
let ingresos     = JSON.parse(localStorage.getItem('agrotrial_ingresos')     || '[]');
let egresos      = JSON.parse(localStorage.getItem('agrotrial_egresos')      || '[]');
let gastosFijos  = JSON.parse(localStorage.getItem('agrotrial_gastosfijos')  || '[]');
let editMode = null; // { type, id }

// ── USUARIOS Y ROLES ───────────────────────────────────
const DEFAULT_USERS = [
  { id: 'u_dueno',    name: 'Dueño AGROTRIAL',       email: 'dueno@agrotrial.com',    role: 'dueno',    pass: '1234',     active: true, avatar: '👑' },
  { id: 'u_operador', name: 'Operador de Carga',     email: 'operador@agrotrial.com', role: 'operador', pass: '1234',     active: true, avatar: '✍️' },
  { id: 'u_admin',    name: 'Administrador Sistema', email: 'admin@agrotrial.com',    role: 'admin',    pass: 'admin123', active: true, avatar: '🛡️' }
];

let usuarios = JSON.parse(localStorage.getItem('agrotrial_usuarios') || 'null');
if (!usuarios || !usuarios.length) {
  usuarios = DEFAULT_USERS;
  localStorage.setItem('agrotrial_usuarios', JSON.stringify(usuarios));
}

let currentUser = JSON.parse(localStorage.getItem('agrotrial_current_user') || 'null');
if (!currentUser) {
  currentUser = usuarios.find(u => u.role === 'dueno') || usuarios[0];
  localStorage.setItem('agrotrial_current_user', JSON.stringify(currentUser));
}

const ROLES_CONFIG = {
  admin: {
    title: 'Administrador',
    badge: '🛡️ Admin',
    badgeClass: 'badge-role-admin',
    allowedPages: ['dashboard', 'ingresos', 'egresos', 'gastosfijos', 'rentabilidad', 'reportes', 'sugerencias', 'usuarios'],
    defaultPage: 'dashboard'
  },
  dueno: {
    title: 'Dueño / Dirección',
    badge: '👑 Dueño',
    badgeClass: 'badge-role-dueno',
    allowedPages: ['dashboard', 'rentabilidad', 'reportes', 'ingresos', 'egresos', 'gastosfijos', 'sugerencias'],
    defaultPage: 'dashboard'
  },
  operador: {
    title: 'Operador de Carga',
    badge: '✍️ Operador',
    badgeClass: 'badge-role-operador',
    allowedPages: ['ingresos', 'egresos', 'gastosfijos', 'dashboard', 'sugerencias'],
    defaultPage: 'ingresos'
  }
};

// ── INIT ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  document.getElementById('badge-year').textContent = now.getFullYear();
  document.getElementById('sidebar-date').textContent = now.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
  document.getElementById('report-date').textContent  = 'Generado: ' + now.toLocaleDateString('es-AR');

  // Default dates
  const today = now.toISOString().split('T')[0];
  document.getElementById('ing-fecha').value  = today;
  document.getElementById('egr-fecha').value  = today;

  // Seed demo data if empty
  if (!ingresos.length && !egresos.length) seedDemoData();

  applyUserRolePermissions();
  refreshAll();
});

// ── NAVIGATION ─────────────────────────────────────────
function showPage(name, el) {
  const config = ROLES_CONFIG[currentUser ? currentUser.role : 'dueno'] || ROLES_CONFIG.dueno;
  if (!config.allowedPages.includes(name)) {
    showToast('⚠️ Tu rol no tiene permisos para ver esta sección');
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
    { dashboard:'Dashboard', ingresos:'Ingresos', egresos:'Egresos',
      rentabilidad:'Rentabilidad', gastosfijos:'Gastos Fijos', reportes:'Reportes',
      sugerencias:'Sugerencias', usuarios:'Gestión de Usuarios' }[name] || name;
  refreshAll();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ── SAVE ───────────────────────────────────────────────
function save() {
  localStorage.setItem('agrotrial_ingresos',     JSON.stringify(ingresos));
  localStorage.setItem('agrotrial_egresos',      JSON.stringify(egresos));
  localStorage.setItem('agrotrial_gastosfijos',  JSON.stringify(gastosFijos));
  localStorage.setItem('agrotrial_usuarios',     JSON.stringify(usuarios));
  localStorage.setItem('agrotrial_current_user', JSON.stringify(currentUser));
}

// ── ADD INGRESO ────────────────────────────────────────
function addIngreso() {
  const fecha   = document.getElementById('ing-fecha').value;
  const desc    = document.getElementById('ing-desc').value.trim();
  const cat     = document.getElementById('ing-cat').value;
  const cliente = document.getElementById('ing-cliente').value.trim();
  const monto   = parseFloat(document.getElementById('ing-monto').value);

  if (!fecha || !desc || !monto || monto <= 0) { showToast('⚠️ Completa todos los campos obligatorios'); return; }

  ingresos.push({ id: Date.now(), fecha, desc, cat, cliente, monto });
  save(); refreshAll();
  document.getElementById('ing-desc').value = '';
  document.getElementById('ing-cliente').value = '';
  document.getElementById('ing-monto').value = '';
  showToast('✅ Ingreso registrado correctamente');
}

// ── ADD EGRESO ─────────────────────────────────────────
function addEgreso() {
  const fecha      = document.getElementById('egr-fecha').value;
  const desc       = document.getElementById('egr-desc').value.trim();
  const cat        = document.getElementById('egr-cat').value;
  const proveedor  = document.getElementById('egr-proveedor').value.trim();
  const monto      = parseFloat(document.getElementById('egr-monto').value);

  if (!fecha || !desc || !monto || monto <= 0) { showToast('⚠️ Completa todos los campos obligatorios'); return; }

  egresos.push({ id: Date.now(), fecha, desc, cat, proveedor, monto });
  save(); refreshAll();
  document.getElementById('egr-desc').value = '';
  document.getElementById('egr-proveedor').value = '';
  document.getElementById('egr-monto').value = '';
  showToast('✅ Egreso registrado correctamente');
}

// ── DELETE ─────────────────────────────────────────────
function deleteItem(type, id) {
  if (!confirm('¿Eliminar este registro?')) return;
  if (type === 'ingreso') ingresos = ingresos.filter(x => x.id !== id);
  else                    egresos  = egresos.filter(x => x.id !== id);
  save(); refreshAll(); showToast('🗑️ Registro eliminado');
}

// ── EDIT MODAL ─────────────────────────────────────────
function openEdit(type, id) {
  const item = type === 'ingreso'
    ? ingresos.find(x => x.id === id)
    : egresos.find(x => x.id === id);
  if (!item) return;
  editMode = { type, id };
  document.getElementById('modal-title').textContent = type === 'ingreso' ? '✏️ Editar Ingreso' : '✏️ Editar Egreso';

  const cats = type === 'ingreso'
    ? ['Ventas','Servicios','Subsidios','Arrendamiento','Otros']
    : ['Insumos','Semillas','Agroquímicos','Mano de Obra','Maquinaria','Combustible','Administración','Impuestos','Otros'];

  const thirdLabel = type === 'ingreso' ? 'Cliente' : 'Proveedor';
  const thirdVal   = type === 'ingreso' ? (item.cliente||'') : (item.proveedor||'');

  document.getElementById('modal-form').innerHTML = `
    <div class="form-group">
      <label>Fecha</label>
      <input type="date" id="m-fecha" class="form-input" value="${item.fecha}"/>
    </div>
    <div class="form-group">
      <label>Descripción</label>
      <input type="text" id="m-desc" class="form-input" value="${item.desc}"/>
    </div>
    <div class="form-group">
      <label>Categoría</label>
      <select id="m-cat" class="form-input">
        ${cats.map(c => `<option${c===item.cat?' selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>${thirdLabel}</label>
      <input type="text" id="m-third" class="form-input" value="${thirdVal}"/>
    </div>
    <div class="form-group">
      <label>Monto ($)</label>
      <input type="number" id="m-monto" class="form-input" value="${item.monto}" step="0.01"/>
    </div>`;

  document.getElementById('modal').classList.add('open');
}

function saveEdit() {
  const { type, id } = editMode;
  const fecha = document.getElementById('m-fecha').value;
  const desc  = document.getElementById('m-desc').value.trim();
  const cat   = document.getElementById('m-cat').value;
  const third = document.getElementById('m-third').value.trim();
  const monto = parseFloat(document.getElementById('m-monto').value);
  if (!fecha || !desc || !monto) { showToast('⚠️ Completa todos los campos'); return; }

  if (type === 'ingreso') {
    const i = ingresos.findIndex(x => x.id === id);
    ingresos[i] = { ...ingresos[i], fecha, desc, cat, cliente: third, monto };
  } else {
    const i = egresos.findIndex(x => x.id === id);
    egresos[i] = { ...egresos[i], fecha, desc, cat, proveedor: third, monto };
  }
  save(); refreshAll(); closeModal(); showToast('✅ Cambios guardados');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  editMode = null;
}

// ── RENDER INGRESOS TABLE ──────────────────────────────
function renderIngresos() {
  const search = (document.getElementById('ing-search')?.value || '').toLowerCase();
  const catF   = document.getElementById('ing-filter-cat')?.value || '';
  let data = ingresos.filter(x =>
    (!search || x.desc.toLowerCase().includes(search) || (x.cliente||'').toLowerCase().includes(search)) &&
    (!catF || x.cat === catF)
  ).sort((a,b) => b.fecha.localeCompare(a.fecha));

  const tbody = document.getElementById('ingresos-tbody');
  if (!tbody) return;
  tbody.innerHTML = data.length ? data.map(x => `
    <tr>
      <td>${fmtDate(x.fecha)}</td>
      <td>${x.desc}</td>
      <td><span class="badge badge-income">${x.cat}</span></td>
      <td>${x.cliente||'–'}</td>
      <td style="color:var(--green);font-weight:600">${fmtMoney(x.monto)}</td>
      <td>
        <button class="action-btn" onclick="openEdit('ingreso',${x.id})" title="Editar">✏️</button>
        <button class="action-btn" onclick="deleteItem('ingreso',${x.id})" title="Eliminar">🗑️</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>';

  document.getElementById('ing-total').textContent = fmtMoney(data.reduce((s,x) => s + x.monto, 0));
}

// ── RENDER EGRESOS TABLE ───────────────────────────────
function renderEgresos() {
  const search = (document.getElementById('egr-search')?.value || '').toLowerCase();
  const catF   = document.getElementById('egr-filter-cat')?.value || '';
  let data = egresos.filter(x =>
    (!search || x.desc.toLowerCase().includes(search) || (x.proveedor||'').toLowerCase().includes(search)) &&
    (!catF || x.cat === catF)
  ).sort((a,b) => b.fecha.localeCompare(a.fecha));

  const tbody = document.getElementById('egresos-tbody');
  if (!tbody) return;
  tbody.innerHTML = data.length ? data.map(x => `
    <tr>
      <td>${fmtDate(x.fecha)}</td>
      <td>${x.desc}</td>
      <td><span class="badge badge-expense">${x.cat}</span></td>
      <td>${x.proveedor||'–'}</td>
      <td style="color:var(--red);font-weight:600">${fmtMoney(x.monto)}</td>
      <td>
        <button class="action-btn" onclick="openEdit('egreso',${x.id})" title="Editar">✏️</button>
        <button class="action-btn" onclick="deleteItem('egreso',${x.id})" title="Eliminar">🗑️</button>
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
  gastosFijos.push({ id: Date.now(), desc, cat, frec, monto, activo: true });
  save(); refreshAll();
  document.getElementById('gf-desc').value  = '';
  document.getElementById('gf-monto').value = '';
  showToast('🔒 Gasto fijo registrado');
}

function toggleGastoFijo(id) {
  const g = gastosFijos.find(x => x.id === id);
  if (g) { g.activo = !g.activo; save(); refreshAll(); }
}

function deleteGastoFijo(id) {
  if (!confirm('¿Eliminar este gasto fijo?')) return;
  gastosFijos = gastosFijos.filter(x => x.id !== id);
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
      <td>${g.desc}</td>
      <td><span class="badge badge-fixed">${g.cat}</span></td>
      <td>${g.frec === 'anual' ? '📅 Anual' : '🔁 Mensual'}</td>
      <td>${fmtMoney(g.monto)}</td>
      <td style="color:var(--orange);font-weight:600">${fmtMoney(cMes)}</td>
      <td>
        <button class="toggle-btn ${g.activo ? 'active' : 'inactive'}" onclick="toggleGastoFijo(${g.id})">
          ${g.activo ? '✅ Activo' : '⏸ Inactivo'}
        </button>
      </td>
      <td>
        <button class="action-btn" onclick="deleteGastoFijo(${g.id})" title="Eliminar">🗑️</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin gastos fijos registrados</td></tr>';
}

// ── DASHBOARD ──────────────────────────────────────────
let chartFlujo = null, chartEgrDist = null, chartRent = null;

function refreshDashboard() {
  const totalIng  = ingresos.reduce((s,x) => s + x.monto, 0);
  const totalEgr  = egresos.reduce((s,x)  => s + x.monto, 0);
  const gfMensual = costoFijoMensual();
  // Para el período total, usamos 12 meses de gastos fijos acumulados (o los meses con datos)
  const mesesConDatos = new Set([
    ...ingresos.map(x => x.fecha.slice(0,7)),
    ...egresos.map(x  => x.fecha.slice(0,7))
  ]).size || 1;
  const totalGF   = gfMensual * mesesConDatos;
  const totalCostos = totalEgr + totalGF;
  const ganancia  = totalIng - totalCostos;
  const margen    = totalIng > 0 ? ((ganancia / totalIng) * 100).toFixed(1) : 0;

  document.getElementById('kpi-ingresos').textContent = fmtMoney(totalIng);
  document.getElementById('kpi-egresos').textContent  = fmtMoney(totalCostos);
  document.getElementById('kpi-egresos-mes').textContent = `Variables: ${fmtMoney(totalEgr)} · Fijos: ${fmtMoney(totalGF)}`;
  document.getElementById('kpi-ganancia').textContent = fmtMoney(ganancia);

  const estadoEl = document.getElementById('kpi-estado');
  if (ganancia > 0)       { estadoEl.textContent = '✅ GANANDO'; estadoEl.className = 'kpi-value status-text ganando'; }
  else if (ganancia < 0)  { estadoEl.textContent = '❌ PERDIENDO'; estadoEl.className = 'kpi-value status-text perdiendo'; }
  else                    { estadoEl.textContent = '⚖️ NEUTRO'; estadoEl.className = 'kpi-value status-text'; }

  document.getElementById('kpi-margen').textContent = `Margen neto: ${margen}%`;

  // Recent table
  const all = [
    ...ingresos.map(x => ({...x, tipo:'ingreso'})),
    ...egresos.map(x  => ({...x, tipo:'egreso'}))
  ].sort((a,b) => b.fecha.localeCompare(a.fecha)).slice(0,8);

  document.getElementById('recent-count').textContent = (ingresos.length + egresos.length) + ' registros';
  document.getElementById('recent-tbody').innerHTML = all.map(x => `
    <tr>
      <td>${fmtDate(x.fecha)}</td>
      <td>${x.desc}</td>
      <td><span class="badge ${x.tipo==='ingreso'?'badge-income':'badge-expense'}">${x.tipo==='ingreso'?'Ingreso':'Egreso'}</span></td>
      <td style="color:${x.tipo==='ingreso'?'var(--green)':'var(--red)'};font-weight:600">${x.tipo==='ingreso'?'+':'-'}${fmtMoney(x.monto)}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:24px">Sin registros aún</td></tr>';

  // Charts
  buildFlujoCaja();
  buildEgresosDist();
}

function buildFlujoCaja() {
  const months = last12Months();
  const ingData = months.map(m => ingresos.filter(x => x.fecha.startsWith(m)).reduce((s,x)=>s+x.monto,0));
  const egrData = months.map(m => egresos.filter(x  => x.fecha.startsWith(m)).reduce((s,x)=>s+x.monto,0));
  const labels  = months.map(m => { const [y,mo]=m.split('-'); return new Date(y,mo-1).toLocaleDateString('es-AR',{month:'short',year:'2-digit'}); });

  const ctx = document.getElementById('chartFlujo');
  if (!ctx) return;
  if (chartFlujo) chartFlujo.destroy();
  chartFlujo = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Ingresos', data: ingData, backgroundColor:'rgba(63,185,80,0.7)', borderColor:'#3fb950', borderWidth:1, borderRadius:4 },
        { label:'Egresos',  data: egrData, backgroundColor:'rgba(248,81,73,0.7)',  borderColor:'#f85149', borderWidth:1, borderRadius:4 }
      ]
    },
    options: chartOpts('$')
  });
}

function buildEgresosDist() {
  const cats = {};
  egresos.forEach(x => { cats[x.cat] = (cats[x.cat]||0) + x.monto; });
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
  const ingYear = ingresos.reduce((s,x)=>s+x.monto,0);
  const egrYear = egresos.reduce((s,x)=>s+x.monto,0);
  const mesesConDatos = new Set([
    ...ingresos.map(x=>x.fecha.slice(0,7)),
    ...egresos.map(x=>x.fecha.slice(0,7))
  ]).size || 1;
  const gfYear  = gfMes * mesesConDatos;
  const costoTotal = egrYear + gfYear;
  const neto    = ingYear - costoTotal;
  const margen  = ingYear > 0 ? ((neto/ingYear)*100).toFixed(1) : 0;

  document.getElementById('rent-ingresos').textContent = fmtMoney(ingYear);
  document.getElementById('rent-egresos').textContent  = fmtMoney(costoTotal);
  document.getElementById('rent-neto').textContent     = fmtMoney(neto);
  document.getElementById('rent-margen').textContent   = margen + '%';

  const rows = months.map(m => {
    const ing = ingresos.filter(x=>x.fecha.startsWith(m)).reduce((s,x)=>s+x.monto,0);
    const egr = egresos.filter(x=>x.fecha.startsWith(m)).reduce((s,x)=>s+x.monto,0);
    // Gastos fijos: se aplican si hay algún movimiento en el mes o si hay gastos fijos activos
    const gf  = (ing > 0 || egr > 0) ? gfMes : 0;
    const costoMes = egr + gf;
    const res = ing - costoMes;
    const mg  = ing > 0 ? ((res/ing)*100).toFixed(1) : '–';
    const [y,mo] = m.split('-');
    const label = new Date(y,mo-1).toLocaleDateString('es-AR',{month:'long',year:'numeric'});
    return { label, ing, egr, gf, costoMes, res, mg };
  }).filter(r => r.ing > 0 || r.egr > 0);

  document.getElementById('rent-tbody').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${r.label}</td>
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
  const totalIng  = ingresos.reduce((s,x)=>s+x.monto,0);
  const totalEgr  = egresos.reduce((s,x)=>s+x.monto,0);
  const gfMensual = costoFijoMensual();
  const mesesConDatos = new Set([
    ...ingresos.map(x=>x.fecha.slice(0,7)),
    ...egresos.map(x=>x.fecha.slice(0,7))
  ]).size || 1;
  const totalGF   = gfMensual * mesesConDatos;
  const totalCostos = totalEgr + totalGF;
  const neto      = totalIng - totalCostos;
  const margen    = totalIng > 0 ? ((neto/totalIng)*100).toFixed(1) : 0;

  const cats = {};
  egresos.forEach(x => { cats[x.cat] = (cats[x.cat]||0) + x.monto; });
  const gfCats = {};
  gastosFijos.filter(g=>g.activo).forEach(g => {
    const v = g.frec === 'anual' ? g.monto / 12 * mesesConDatos : g.monto * mesesConDatos;
    gfCats[g.cat] = (gfCats[g.cat]||0) + v;
  });

  let rows = `
    <tr><td><strong>TOTAL INGRESOS</strong></td><td style="color:var(--green);font-weight:700">${fmtMoney(totalIng)}</td></tr>
    <tr><td><strong>Egresos Variables</strong></td><td style="color:var(--red)">${fmtMoney(totalEgr)}</td></tr>
    <tr><td><strong>🔒 Gastos Fijos (${mesesConDatos} mes/es)</strong></td><td style="color:var(--orange)">${fmtMoney(totalGF)}</td></tr>
    <tr><td><strong>TOTAL COSTOS</strong></td><td style="color:var(--red);font-weight:700">${fmtMoney(totalCostos)}</td></tr>
    <tr style="border-top:2px solid var(--border)">
      <td><strong>RESULTADO NETO</strong></td>
      <td class="${neto>=0?'positive':'negative'}" style="font-size:16px;font-weight:800">${fmtMoney(neto)}</td>
    </tr>
    <tr><td>Margen Neto</td><td class="${neto>=0?'positive':'negative'}">${margen}%</td></tr>
    <tr><td colspan="2" style="padding-top:16px;font-weight:700;color:var(--text2)">DESGLOSE EGRESOS VARIABLES</td></tr>
  `;
  Object.entries(cats).forEach(([k,v]) => {
    rows += `<tr><td style="padding-left:16px">– ${k}</td><td>${fmtMoney(v)}</td></tr>`;
  });
  if (Object.keys(gfCats).length) {
    rows += `<tr><td colspan="2" style="padding-top:16px;font-weight:700;color:var(--text2)">DESGLOSE GASTOS FIJOS</td></tr>`;
    Object.entries(gfCats).forEach(([k,v]) => {
      rows += `<tr><td style="padding-left:16px">🔒 ${k}</td><td style="color:var(--orange)">${fmtMoney(v)}</td></tr>`;
    });
  }

  document.getElementById('report-tbody').innerHTML = rows;
}

function exportCSV() {
  let csv = 'Tipo,Fecha,Descripción,Categoría,Detalle,Monto\n';
  ingresos.forEach(x => { csv += `Ingreso,${x.fecha},"${x.desc}",${x.cat},"${x.cliente||''}",${x.monto}\n`; });
  egresos.forEach(x  => { csv += `Egreso Variable,${x.fecha},"${x.desc}",${x.cat},"${x.proveedor||''}",${x.monto}\n`; });
  gastosFijos.filter(g=>g.activo).forEach(g => {
    const cMes = g.frec === 'anual' ? (g.monto/12).toFixed(2) : g.monto;
    csv += `Gasto Fijo,Mensual,"${g.desc}",${g.cat},"${g.frec}",${cMes}\n`;
  });
  const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AGROTRIAL_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  showToast('📥 CSV exportado correctamente');
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
}

// ── SUGERENCIAS ─────────────────────────────────────────
let sugerencias = JSON.parse(localStorage.getItem('agrotrial_sugerencias') || '[]');

const CATALOG = [
  { id:'c1',  icon:'📦', nombre:'Gestión de Stock / Inventario',     desc:'Control de insumos, semillas, agroquímicos y herramientas en existencia.',       cat:'Producción / Campo', votos:0, estado:'sugerido' },
  { id:'c2',  icon:'🌱', nombre:'Gestión de Cultivos / Lotes',        desc:'Seguimiento de cada lote: siembra, labores, cosecha y rendimiento por hectárea.', cat:'Producción / Campo', votos:0, estado:'sugerido' },
  { id:'c3',  icon:'👷', nombre:'Recursos Humanos / Personal',        desc:'Control de empleados, jornales, liquidación de sueldos y asistencia.',            cat:'Recursos Humanos',  votos:0, estado:'sugerido' },
  { id:'c4',  icon:'🏪', nombre:'Gestión de Proveedores',             desc:'Registro de proveedores, historial de compras y condiciones de pago.',            cat:'Administración',    votos:0, estado:'sugerido' },
  { id:'c5',  icon:'🚜', nombre:'Maquinaria y Mantenimiento',         desc:'Control de flota, historial de reparaciones, costos y vencimiento de revisiones.', cat:'Logística',         votos:0, estado:'sugerido' },
  { id:'c6',  icon:'📅', nombre:'Planificación de Campaña',           desc:'Planificá la campaña por lote: fechas, presupuesto estimado y objetivo.',         cat:'Producción / Campo', votos:0, estado:'sugerido' },
  { id:'c7',  icon:'💳', nombre:'Cuentas Corrientes / Deudores',     desc:'Seguimiento de clientes con cuenta corriente, saldo y vencimientos.',             cat:'Finanzas',          votos:0, estado:'sugerido' },
  { id:'c8',  icon:'🌦️', nombre:'Registro de Lluvias y Clima',       desc:'Registro manual o automático de precipitaciones por lote o zona.',               cat:'Producción / Campo', votos:0, estado:'sugerido' },
  { id:'c9',  icon:'📊', nombre:'Presupuestos y Proyecciones',        desc:'Creá presupuestos por campaña y compará contra lo ejecutado.',                    cat:'Finanzas',          votos:0, estado:'sugerido' },
  { id:'c10', icon:'🧾', nombre:'Facturación / Comprobantes',         desc:'Emisión y registro de facturas, remitos y recibos de pago.',                      cat:'Administración',    votos:0, estado:'sugerido' },
];

// Merge votos guardados en catalog
function getCatalogVotos() {
  const saved = JSON.parse(localStorage.getItem('agrotrial_catalog_votos') || '{}');
  return CATALOG.map(c => ({ ...c, votos: saved[c.id] || 0, votado: !!saved[c.id + '_votado'] }));
}

function votarCatalog(id) {
  const saved  = JSON.parse(localStorage.getItem('agrotrial_catalog_votos') || '{}');
  const key    = id + '_votado';
  if (saved[key]) { showToast('Ya votaste este módulo'); return; }
  saved[id]  = (saved[id] || 0) + 1;
  saved[key] = true;
  localStorage.setItem('agrotrial_catalog_votos', JSON.stringify(saved));
  renderSugerencias();
  showToast('✅ Voto registrado');
}

function addSugerencia() {
  const nombre    = document.getElementById('sug-nombre').value.trim();
  const desc      = document.getElementById('sug-desc').value.trim();
  const cat       = document.getElementById('sug-cat').value;
  const prioridad = document.getElementById('sug-prioridad').value;
  if (!nombre) { showToast('⚠️ Ingresá el nombre del módulo'); return; }
  sugerencias.push({ id: Date.now(), nombre, desc, cat, prioridad, votos: 1, fecha: new Date().toLocaleDateString('es-AR') });
  localStorage.setItem('agrotrial_sugerencias', JSON.stringify(sugerencias));
  document.getElementById('sug-nombre').value = '';
  document.getElementById('sug-desc').value   = '';
  renderSugerencias();
  showToast('💡 Sugerencia enviada. ¡Gracias!');
}

function votarSugerencia(id) {
  const s = sugerencias.find(x => x.id === id);
  if (s) { s.votos = (s.votos || 1) + 1; localStorage.setItem('agrotrial_sugerencias', JSON.stringify(sugerencias)); renderSugerencias(); showToast('👍 Voto registrado'); }
}

function deleteSugerencia(id) {
  sugerencias = sugerencias.filter(x => x.id !== id);
  localStorage.setItem('agrotrial_sugerencias', JSON.stringify(sugerencias));
  renderSugerencias();
}

const PRIORIDAD_LABEL = { alta:'🔴 Alta', media:'🟡 Media', baja:'🟢 Baja' };

function renderSugerencias() {
  const catalog = document.getElementById('sug-catalog');
  const userList = document.getElementById('sug-user-list');
  const userTitle = document.getElementById('sug-user-title');
  if (!catalog) return;

  const items = getCatalogVotos().sort((a,b) => b.votos - a.votos);
  catalog.innerHTML = items.map(c => `
    <div class="sug-card ${c.votado ? 'voted' : ''}">
      <div class="sug-card-icon">${c.icon}</div>
      <div class="sug-card-body">
        <div class="sug-card-name">${c.nombre}</div>
        <div class="sug-card-desc">${c.desc}</div>
        <div class="sug-card-meta"><span class="badge badge-fixed">${c.cat}</span></div>
      </div>
      <div class="sug-card-vote">
        <button class="vote-btn ${c.votado ? 'voted' : ''}" onclick="votarCatalog('${c.id}')">
          👍 <span>${c.votos}</span>
        </button>
        <div class="sug-estado sugerido">Sugerido</div>
      </div>
    </div>`).join('');

  if (sugerencias.length) {
    userTitle.style.display = 'block';
    userList.innerHTML = sugerencias.sort((a,b) => b.votos - a.votos).map(s => `
      <div class="sug-card user-sug">
        <div class="sug-card-icon">💬</div>
        <div class="sug-card-body">
          <div class="sug-card-name">${s.nombre}</div>
          <div class="sug-card-desc">${s.desc || 'Sin descripción'}</div>
          <div class="sug-card-meta">
            <span class="badge badge-fixed">${s.cat}</span>
            <span class="badge" style="background:rgba(255,255,255,0.05);color:var(--text2)">${PRIORIDAD_LABEL[s.prioridad]||''}</span>
            <span style="font-size:11px;color:var(--text2)">Enviado: ${s.fecha||''}</span>
          </div>
        </div>
        <div class="sug-card-vote">
          <button class="vote-btn" onclick="votarSugerencia(${s.id})">👍 <span>${s.votos}</span></button>
          <button class="action-btn" onclick="deleteSugerencia(${s.id})" title="Eliminar">🗑️</button>
        </div>
      </div>`).join('');
  } else {
    userTitle.style.display = 'none';
    userList.innerHTML = '';
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

// ── DEMO DATA ──────────────────────────────────────────
function seedDemoData() {
  const year = new Date().getFullYear();
  const months = ['01','02','03','04','05'];
  const ingCats = ['Ventas','Ventas','Servicios','Arrendamiento'];
  const egrCats = ['Insumos','Semillas','Agroquímicos','Mano de Obra','Combustible'];

  months.forEach(mo => {
    ingresos.push({ id: Date.now() + Math.random(), fecha:`${year}-${mo}-10`, desc:'Venta de granos', cat:'Ventas', cliente:'AcoPio Sur', monto: 800000 + Math.random()*400000 });
    ingresos.push({ id: Date.now() + Math.random(), fecha:`${year}-${mo}-20`, desc:'Servicio de siembra', cat:'Servicios', cliente:'Estancia La Paz', monto: 150000 + Math.random()*100000 });
    egresos.push({ id: Date.now() + Math.random(), fecha:`${year}-${mo}-05`, desc:'Compra de semillas', cat:'Semillas', proveedor:'AgroSeed', monto: 120000 + Math.random()*80000 });
    egresos.push({ id: Date.now() + Math.random(), fecha:`${year}-${mo}-15`, desc:'Agroquímicos herbicidas', cat:'Agroquímicos', proveedor:'Bayer', monto: 200000 + Math.random()*100000 });
    egresos.push({ id: Date.now() + Math.random(), fecha:`${year}-${mo}-25`, desc:'Combustible maquinaria', cat:'Combustible', proveedor:'YPF', monto: 80000 + Math.random()*40000 });
  });
  save();
}

// ── SISTEMA MULTI-ROL Y PERMISOS ───────────────────────

function applyUserRolePermissions() {
  const config = ROLES_CONFIG[currentUser ? currentUser.role : 'dueno'] || ROLES_CONFIG.dueno;

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

  // Ajustes de Dashboard si es operador (protege margen confidencial)
  const profitKpi = document.querySelector('.kpi-card.profit');
  const statusKpi = document.querySelector('.kpi-card.status');
  if (currentUser.role === 'operador') {
    if (profitKpi) {
      const ganEl = document.getElementById('kpi-ganancia');
      const marEl = document.getElementById('kpi-margen');
      if (ganEl) ganEl.textContent = '🔒 Confidencial';
      if (marEl) marEl.textContent = 'Acceso Dueño / Admin';
    }
    if (statusKpi) {
      const estadoEl = document.getElementById('kpi-estado');
      const resEl = document.getElementById('kpi-resultado');
      if (estadoEl) { estadoEl.textContent = '📋 Operativo'; estadoEl.className = 'kpi-value status-text'; }
      if (resEl) resEl.textContent = 'Perfil de Carga';
    }
  }

  // Si la página actual no está permitida, redirigir a la página default del rol
  const activePageEl = document.querySelector('.page.active');
  const currentActivePage = activePageEl ? activePageEl.id.replace('page-', '') : 'dashboard';
  if (!config.allowedPages.includes(currentActivePage)) {
    showPage(config.defaultPage);
  }
}

// ── MODAL LOGIN & SWITCH USER ──────────────────────────

function openLoginModal() {
  document.getElementById('modal-login').classList.add('open');
}

function closeLoginModal() {
  document.getElementById('modal-login').classList.remove('open');
}

function quickLogin(role) {
  const user = usuarios.find(u => u.role === role && u.active) || usuarios.find(u => u.role === role);
  if (!user) {
    showToast('⚠️ No se encontró usuario para este rol');
    return;
  }
  currentUser = user;
  save();
  applyUserRolePermissions();
  refreshAll();
  closeLoginModal();
  showToast(`👋 Bienvenido: ${user.name} (${ROLES_CONFIG[role].title})`);
}

function handleManualLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pass  = document.getElementById('login-pass').value.trim();

  const user = usuarios.find(u => u.email.toLowerCase() === email && u.pass === pass);
  if (!user) {
    showToast('❌ Credenciales inválidas. Verificá email y contraseña');
    return;
  }
  if (!user.active) {
    showToast('⚠️ Este usuario está desactivado por el Administrador');
    return;
  }

  currentUser = user;
  save();
  applyUserRolePermissions();
  refreshAll();
  closeLoginModal();
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
  showToast(`✅ Sesión iniciada: ${user.name}`);
}

// ── GESTIÓN DE USUARIOS (ADMIN) ────────────────────────

function addUser() {
  const nombre = document.getElementById('usr-nombre').value.trim();
  const email  = document.getElementById('usr-email').value.trim().toLowerCase();
  const role   = document.getElementById('usr-role').value;
  const pass   = document.getElementById('usr-pass').value.trim() || '1234';

  if (!nombre || !email) {
    showToast('⚠️ Completá el nombre y el correo');
    return;
  }

  if (usuarios.some(u => u.email.toLowerCase() === email)) {
    showToast('⚠️ Ya existe un usuario registrado con ese email');
    return;
  }

  const avatars = { admin: '🛡️', dueno: '👑', operador: '✍️' };
  usuarios.push({
    id: 'u_' + Date.now(),
    name: nombre,
    email,
    role,
    pass,
    active: true,
    avatar: avatars[role] || '👤'
  });

  save();
  renderUsuarios();
  document.getElementById('usr-nombre').value = '';
  document.getElementById('usr-email').value = '';
  document.getElementById('usr-pass').value = '';
  showToast('✅ Usuario creado exitosamente');
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
    const config = ROLES_CONFIG[u.role] || ROLES_CONFIG.dueno;
    return `
      <tr style="${u.active ? '' : 'opacity:0.45'}">
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">${u.avatar || '👤'}</span>
            <strong>${u.name}</strong>
            ${u.id === currentUser.id ? '<span class="badge badge-income" style="font-size:10px;">En sesión</span>' : ''}
          </div>
        </td>
        <td><code>${u.email}</code></td>
        <td><span class="badge ${config.badgeClass}">${config.badge}</span></td>
        <td>
          <button class="toggle-btn ${u.active ? 'active' : 'inactive'}" onclick="toggleUserStatus('${u.id}')">
            ${u.active ? '✅ Activo' : '⏸ Inactivo'}
          </button>
        </td>
        <td>
          ${u.id !== currentUser.id ? `<button class="action-btn" onclick="deleteUser('${u.id}')" title="Eliminar">🗑️</button>` : '–'}
        </td>
      </tr>
    `;
  }).join('');
}

// ── NUBE Y SINCRONIZACIÓN ──────────────────────────────

function openCloudModal() {
  document.getElementById('modal-cloud').classList.add('open');
}

function closeCloudModal() {
  document.getElementById('modal-cloud').classList.remove('open');
}

function exportDatabaseJSON() {
  const data = {
    empresa: 'AGROTRIAL',
    version: '2.0',
    exportadoEn: new Date().toISOString(),
    ingresos,
    egresos,
    gastosFijos,
    sugerencias,
    usuarios
  };

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AGROTRIAL_DATABASE_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  showToast('☁️ Respaldo de Base de Datos descargado');
}

function importDatabaseJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = JSON.parse(evt.target.result);
      if (!data.ingresos || !data.egresos) {
        showToast('❌ Archivo de base de datos no compatible');
        return;
      }
      ingresos    = data.ingresos || [];
      egresos     = data.egresos || [];
      gastosFijos = data.gastosFijos || [];
      if (data.sugerencias) sugerencias = data.sugerencias;
      if (data.usuarios && data.usuarios.length) usuarios = data.usuarios;

      save();
      refreshAll();
      closeCloudModal();
      showToast('✅ ¡Base de datos de AGROTRIAL sincronizada!');
    } catch(err) {
      showToast('❌ Error al procesar archivo JSON');
    }
  };
  reader.readAsText(file);
}
