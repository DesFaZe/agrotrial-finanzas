import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: "Falta configurar el entorno de la función" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(401, { error: "Se requiere una sesión autenticada" });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json(401, { error: "Sesión inválida" });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profileError } = await adminClient
    .from("app_profiles")
    .select("role, active")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) return json(500, { error: "No se pudo validar el rol" });
  if (!profile || profile.role !== "admin" || profile.active !== true) {
    return json(403, { error: "Solo un administrador activo puede invitar usuarios" });
  }

  let input: { email?: string; name?: string; role?: string; avatar?: string };
  try {
    input = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const role = String(input.role ?? "contabilidad");
  const avatar = String(input.avatar ?? "👤").slice(0, 16);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "Correo electrónico inválido" });
  }
  if (!name || name.length > 120) return json(400, { error: "Nombre obligatorio (máximo 120 caracteres)" });
  if (!["admin", "administracion", "contabilidad"].includes(role)) {
    return json(400, { error: "Rol no permitido" });
  }

  const { data: invitation, error: inviteError } = await adminClient.auth.admin
    .inviteUserByEmail(email, { data: { name, avatar } });

  if (inviteError || !invitation.user) {
    return json(400, { error: inviteError?.message ?? "No se pudo enviar la invitación" });
  }

  // El trigger SQL crea el perfil desactivado; se habilita y asigna el rol aquí,
  // después de comprobar que quien ejecuta la operación es un administrador activo.
  const { error: updateError } = await adminClient
    .from("app_profiles")
    .update({ name, role, active: true, avatar, email })
    .eq("id", invitation.user.id);

  if (updateError) {
    return json(500, {
      error: "La invitación fue creada, pero no se pudo completar el perfil. Revisá app_profiles antes de reintentar.",
      userId: invitation.user.id,
    });
  }

  return json(200, { ok: true, userId: invitation.user.id, email, role });
});
