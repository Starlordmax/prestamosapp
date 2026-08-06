# App para prestamos

Website React + Supabase que replica las funciones principales del LWC `loanDashboard`:

- Clientes
- Prestamos activos
- Pagos
- Calendario de cuotas
- Bot local de consultas
- Dashboard responsive para telefono y desktop
- Acceso por codigo enviado al correo con Supabase Auth
- Cierre automatico de sesion tras 1 hora de inactividad

## Ejecutar

```powershell
npm install
npm run dev
```

## Supabase

Proyecto conectado:

- URL: https://wowogbyyxxbpnycveegg.supabase.co
- Tablas: `clientes__c`, `prestamo__c`, `prestamo_movimiento__c`, `prestamo_cuota__c`

## Deploy en Render

Este proyecto ya incluye `render.yaml`, asi que Render puede crearlo como Blueprint.

Opcion recomendada:

1. Sube esta carpeta a un repositorio de GitHub.
2. En Render, selecciona **New > Blueprint**.
3. Conecta el repositorio.
4. Render detectara `render.yaml`.
5. Confirma el servicio `app-para-prestamos`.

Configuracion equivalente si lo haces manualmente como Static Site:

- Type: `Static Site`
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- Rewrite rule: `/* -> /index.html`

Variables incluidas en `render.yaml`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Seguridad

La app requiere una sesion Supabase Auth. El codigo usa `shouldCreateUser: false`, asi que primero debes crear los correos autorizados en Supabase:

1. Supabase Dashboard > Authentication > Users.
2. Add user.
3. Usa el correo autorizado.
4. Marca el correo como confirmado si Supabase lo solicita.

Para que el correo muestre un codigo de 6 digitos, revisa:

1. Supabase Dashboard > Authentication > Email Templates.
2. Abre la plantilla de Magic Link / OTP.
3. Asegurate de incluir `{{ .Token }}` en el cuerpo del correo.

SQL recomendado para activar RLS cuando estes listo:

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.clientes__c enable row level security;
alter table public.prestamo__c enable row level security;
alter table public.prestamo_movimiento__c enable row level security;
alter table public.prestamo_cuota__c enable row level security;

create policy "Authenticated users can manage clientes"
on public.clientes__c
for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage prestamos"
on public.prestamo__c
for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage movimientos"
on public.prestamo_movimiento__c
for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage cuotas"
on public.prestamo_cuota__c
for all
to authenticated
using (true)
with check (true);
```

Nota: esta politica permite que cualquier usuario autenticado autorizado en Supabase maneje toda la cartera. Si necesitas permisos por usuario/rol, agrega columnas de ownership/roles antes de activar politicas mas finas.
