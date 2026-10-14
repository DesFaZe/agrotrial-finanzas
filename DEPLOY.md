# 🌾 AGROTRIAL – Guía de Deploy en GitHub Pages

## Paso 1 – Instalar Git
Descargá e instalá Git desde: **https://git-scm.com/download/win**
> Aceptá todas las opciones predeterminadas. Reiniciá la terminal después.

---

## Paso 2 – Crear cuenta en GitHub
Si no tenés cuenta: **https://github.com/signup** (es gratuito)

---

## Paso 3 – Crear el repositorio en GitHub
1. Entrá a **https://github.com/new**
2. Nombre del repositorio: `agrotrial-finanzas`
3. Marcá como **Público** ✅
4. Hacé clic en **"Create repository"**

---

## Paso 4 – Subir el proyecto (desde PowerShell)
Abrí PowerShell en la carpeta del proyecto y ejecutá estos comandos uno por uno:

```powershell
cd "C:\Users\rolon\Documents\OscarAntigravity\agrotrial-finanzas"

git init
git add .
git commit -m "Primer deploy AGROTRIAL Sistema Financiero"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/agrotrial-finanzas.git
git push -u origin main
```
> ⚠️ Reemplazá `TU_USUARIO` con tu nombre de usuario de GitHub

---

## Paso 5 – Activar GitHub Pages
1. Entrá a tu repositorio en GitHub
2. Hacé clic en **Settings** (Configuración)
3. En el menú izquierdo, hacé clic en **Pages**
4. En "Branch", seleccioná **main** y carpeta **/ (root)**
5. Hacé clic en **Save**

---

## Paso 6 – Acceder a tu sistema en línea
Después de 1-2 minutos, tu sistema estará disponible en:

```
https://TU_USUARIO.github.io/agrotrial-finanzas/
```

✅ ¡Listo! Podés compartir ese link con toda tu empresa.

---

## ⚠️ Importante sobre los datos
- Los datos se guardan en el **navegador** (LocalStorage)
- Cada persona que use la app desde su dispositivo tendrá sus propios datos
- Si querés datos **compartidos entre varios usuarios**, avisame para agregar una base de datos en la nube (Firebase gratis)

---

## 🔄 Actualizar el sistema en el futuro
Cuando hagamos cambios, ejecutá:
```powershell
cd "C:\Users\rolon\Documents\OscarAntigravity\agrotrial-finanzas"
git add .
git commit -m "Actualización del sistema"
git push
```
GitHub Pages se actualiza automáticamente en 1-2 minutos.
