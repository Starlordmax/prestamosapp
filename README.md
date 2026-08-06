# App para prestamos

Website React + Supabase que replica las funciones principales del LWC `loanDashboard`:

- Clientes
- Prestamos activos
- Pagos
- Calendario de cuotas
- Bot local de consultas
- Dashboard responsive para telefono y desktop

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

Las tablas estan actualmente con RLS apagado para que la app pueda funcionar directo con la publishable key. Para produccion conviene agregar login, activar RLS y crear policies.
