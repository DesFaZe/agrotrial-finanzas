# AGROTRIAL Finanzas — preparación de Supabase

Esta rama prepara la base de datos centralizada, las reglas de acceso y la invitación segura de usuarios. **Todavía no activa la sincronización en la aplicación**: hace falta crear el proyecto Supabase, configurar sus credenciales públicas y migrar con cuidado la lógica de IndexedDB.

## Qué se agrega

- `supabase/migrations/202610150001_initial_schema.sql`: tablas, roles, políticas RLS y habilitación de Realtime.
- `supabase/config.example.js`: ejemplo de configuración pública del cliente; no contiene credenciales reales.
- `supabase/functions/admin-invite-user/index.ts`: función de servidor para invitar usuarios; verifica que quien llama sea administrador activo.
- Tablas:
  - `app_profiles`: perfil, rol y estado de cada usuario autenticado.
  - `app_records`: registros JSONB de `ingresos`, `egresos`, `gastosfijos`, `sugerencias` y `meta`.

## Crear el proyecto

1. Creá un proyecto en [Supabase](https://supabase.com/dashboard).
2. En **Project Settings → API**, copiá la URL del proyecto y la publishable key (o la legacy anon key). No uses una secret key ni `service_role` en el navegador.
3. En **SQL Editor**, ejecutá el contenido de la migración SQL. Revisá que termine sin errores.
4. En **Authentication → URL Configuration**, configurá la URL de la aplicación publicada y la URL de redirección para invitaciones.
5. Desactivá el registro público de usuarios si no querés que cualquier persona cree cuentas. Los usuarios deben crearse mediante invitaciones administrativas.

## Primer administrador

El primer administrador se debe habilitar manualmente después de crear su usuario de Auth y de que el trigger genere su fila en `app_profiles`. Desde el SQL Editor, verificá primero el correo exacto:

```sql
select id, email, role, active
from public.app_profiles
order by created_at;
```

Luego actualizá solo el usuario verificado:

```sql
update public.app_profiles
set role = 'admin', active = true
where email = 'TU_CORREO_ADMINISTRADOR';
```

No ejecutes la actualización con un correo de ejemplo. Confirmá que afectó exactamente una fila.

## Publicar la función de invitación

Con Supabase CLI instalado y vinculado al proyecto:

```sh
supabase functions deploy admin-invite-user
```

La función usa los secretos del entorno de Supabase. No guardes la service-role key en GitHub ni en archivos frontend. La función solo permite invitar usuarios a una sesión de administrador activa.

## Importante antes de activar la aplicación

- La aplicación actual usa IndexedDB y autenticación local. Estos archivos preparan la infraestructura, pero **no cambian todavía el inicio de sesión ni los guardados actuales**.
- No importes los datos de producción hasta hacer una copia JSON verificada y definir cómo se resolverán IDs duplicados y conflictos.
- Los usuarios existentes en IndexedDB no son usuarios de Supabase Auth. Deben invitarse o migrarse de forma controlada; no se deben copiar contraseñas en texto plano.
- Las reglas RLS protegen el acceso a las tablas; probá accesos permitidos y denegados con cuentas de cada rol antes de cargar datos reales.
- Realtime está habilitado para los registros. La sincronización visible en la interfaz requiere conectar el cliente y reemplazar las funciones locales de lectura/escritura por operaciones remotas.
- La tabla de registros usa JSONB para facilitar la migración inicial. Una vez estabilizada la integración, conviene normalizar entidades y restricciones financieras que requieran integridad relacional.

## Matriz de permisos inicial

| Operación | Admin | Administración | Contabilidad |
|---|---:|---:|---:|
| Leer registros financieros | Sí | Sí | Sí |
| Crear/editar ingresos, egresos y gastos fijos | Sí | No | Sí |
| Leer sugerencias | Sí | No | No |
| Enviar sugerencias | Sí | Sí | Sí |
| Eliminar registros financieros | Sí | No | No |
| Gestionar perfiles e invitar usuarios | Sí | No | No |

Esta matriz debe compararse con los permisos exactos de la aplicación actual antes de activar la integración.
