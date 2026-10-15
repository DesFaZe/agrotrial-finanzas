# Supabase

La configuración y los pasos de instalación están en [SUPABASE_SETUP.md](../SUPABASE_SETUP.md).

- `migrations/`: esquema PostgreSQL y políticas RLS.
- `functions/admin-invite-user/`: invitación de usuarios protegida por rol de administrador.
- `config.example.js`: ejemplo de configuración del cliente sin credenciales reales.

Estos archivos son la base de la integración; no activar la app contra una base vacía hasta implementar y probar la capa de sincronización y la migración de los datos locales.
