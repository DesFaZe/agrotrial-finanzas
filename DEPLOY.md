# 🌾 AGROTRIAL – Sistema de Finanzas y Contabilidad en la Nube

## 🚀 Estado de la Subida a GitHub
El repositorio local ya está **100% configurado, inicializado y con commit realizado**.
- **Repositorio remoto:** `https://github.com/DesFaZe/agrotrial-finanzas.git`
- **Rama principal:** `main`

### 📤 Para completar la subida a GitHub:
En tu terminal de PowerShell (donde estabas en la captura), simplemente ejecutá:

```powershell
git push -u origin main
```
> Si te abre una ventana emergente de GitHub en Windows, hacé clic en **"Sign in with your browser"** para autorizar una sola vez.

---

## 🌐 Activar GitHub Pages (Para acceder online desde cualquier dispositivo)
1. Entrá a tu repositorio: **https://github.com/DesFaZe/agrotrial-finanzas**
2. Hacé clic en la pestaña **Settings** (arriba a la derecha con el icono de engranaje ⚙️)
3. En el menú izquierdo, hacé clic en **Pages**
4. En **Build and deployment > Branch**, elegí:
   - Branch: **`main`**
   - Folder: **`/ (root)`**
5. Hacé clic en **Save**
6. En 1-2 minutos, tu sistema estará activo en:
   👉 **`https://desfaze.github.io/agrotrial-finanzas/`**

---

## 👥 Roles del Sistema y Cuentas Preconfiguradas

Cada rol tiene su **propia interfaz, permisos y vistas personalizadas**:

| Rol | Perfil / Interfaz | Usuario Demo | Contraseña Demo | Secciones con Acceso |
|---|---|---|---|---|
| 👑 **Dueño** | **Interfaz Ejecutiva** | `dueno@agrotrial.com` | `1234` | Dashboard directivo, Rentabilidad (P&L completo, márgenes netos), Reportes y balances descargables, Sugerencias de módulos. |
| ✍️ **Operador de Carga** | **Interfaz Operativa** | `operador@agrotrial.com` | `1234` | Carga de ventas/ingresos, gastos variables (semillas, gasoil, agroquímicos), gastos fijos mensuales, sugerencias. *(Márgenes confidenciales protegidos)* |
| 🛡️ **Administrador** | **Control Total** | `admin@agrotrial.com` | `admin123` | Control total del sistema, configuración, carga financiera completa y **Gestión de Usuarios** (crear, activar/desactivar empleados y asignar roles). |

> 💡 **Cambio Rápido de Rol**: Podés hacer clic en el nombre de usuario (arriba a la derecha o en la barra lateral) en cualquier momento para alternar entre perfiles con un solo clic o iniciar sesión con credenciales.

---

## ☁️ Sincronización en la Nube
- Hacé clic en el botón **`☁️ Nube`** en la barra superior para:
  - Descargar un respaldo completo de la base de datos en formato JSON (`💾 Descargar Respaldo Nube`).
  - Cargar datos en cualquier otro celular o computadora (`📥 Cargar Datos de la Nube`).
  - O sincronizar mediante Firebase Firestore para actualización en tiempo real entre múltiples dispositivos.
