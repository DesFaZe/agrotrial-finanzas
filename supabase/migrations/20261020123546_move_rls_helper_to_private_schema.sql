-- Keep role lookup out of the exposed public API schema.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
CREATE OR REPLACE FUNCTION private.current_app_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.role FROM public.app_profiles AS p
  WHERE p.id = (SELECT auth.uid()) AND p.active = true LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.current_app_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_app_role() TO authenticated;

DROP POLICY IF EXISTS profile_read_self_or_admin ON public.app_profiles;
CREATE POLICY profile_read_self_or_admin ON public.app_profiles FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT private.current_app_role()) = 'admin');
DROP POLICY IF EXISTS profile_update_admin_only ON public.app_profiles;
CREATE POLICY profile_update_admin_only ON public.app_profiles FOR UPDATE TO authenticated
USING ((SELECT private.current_app_role()) = 'admin')
WITH CHECK ((SELECT private.current_app_role()) = 'admin');
DROP POLICY IF EXISTS finance_read_active_users ON public.app_records;
CREATE POLICY finance_read_active_users ON public.app_records FOR SELECT TO authenticated
USING ((SELECT private.current_app_role()) IS NOT NULL AND (collection <> 'sugerencias' OR (SELECT private.current_app_role()) = 'admin' OR payload ->> 'autorId' = (SELECT auth.uid())::text));
DROP POLICY IF EXISTS finance_insert_authorized ON public.app_records;
CREATE POLICY finance_insert_authorized ON public.app_records FOR INSERT TO authenticated WITH CHECK (
 (collection IN ('ingresos','egresos','gastosfijos') AND (SELECT private.current_app_role()) IN ('admin','administracion','contabilidad'))
 OR (collection = 'sugerencias' AND (SELECT private.current_app_role()) IS NOT NULL)
 OR (collection = 'meta' AND (SELECT private.current_app_role()) = 'admin')
);
DROP POLICY IF EXISTS finance_update_authorized ON public.app_records;
CREATE POLICY finance_update_authorized ON public.app_records FOR UPDATE TO authenticated
USING (
 (collection IN ('ingresos','egresos','gastosfijos') AND (SELECT private.current_app_role()) IN ('admin','administracion','contabilidad'))
 OR (collection = 'sugerencias' AND (SELECT private.current_app_role()) = 'admin')
 OR (collection = 'meta' AND (SELECT private.current_app_role()) = 'admin')
)
WITH CHECK (
 (collection IN ('ingresos','egresos','gastosfijos') AND (SELECT private.current_app_role()) IN ('admin','administracion','contabilidad'))
 OR (collection = 'sugerencias' AND (SELECT private.current_app_role()) = 'admin')
 OR (collection = 'meta' AND (SELECT private.current_app_role()) = 'admin')
);
DROP POLICY IF EXISTS finance_delete_authorized ON public.app_records;
CREATE POLICY finance_delete_authorized ON public.app_records FOR DELETE TO authenticated USING (
 (collection IN ('ingresos','egresos','gastosfijos') AND (SELECT private.current_app_role()) IN ('admin','administracion','contabilidad'))
 OR (collection = 'sugerencias' AND (SELECT private.current_app_role()) = 'admin')
);
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.current_app_role();
