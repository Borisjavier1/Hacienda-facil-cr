# Hacienda Facil CR

Micro-SaaS para contadores y pymes en Costa Rica. Permite consultar situacion tributaria y actividades economicas (incluyendo codigos CAByS) por cedula, con cache de 24 horas en Supabase.

## Stack

- Next.js App Router + React 19
- Tailwind CSS
- Componentes estilo shadcn/ui
- Supabase (PostgreSQL) para cache

## Configuracion local

1. Instala dependencias:

```bash
npm install
```

2. Crea tu archivo `.env.local` a partir de `.env.example`:

```bash
cp .env.example .env.local
```

3. Agrega credenciales de Supabase en `.env.local`:

```bash
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SECRET_KEY=TU_SUPABASE_SECRET_KEY
```

Tambien puedes usar la variable legacy `SUPABASE_SERVICE_ROLE_KEY` si tu panel aun muestra ese formato.

4. Ejecuta el SQL de cache en tu panel de Supabase usando `supabase/schema.sql`.

5. Ejecuta en desarrollo:

```bash
npm run dev
```

Abre `http://localhost:3000`.

## Endpoint interno

- `POST /api/consulta`
- Body JSON:

```json
{
	"cedula": "3101123456"
}
```

Flujo:

1. Valida y normaliza la cedula.
2. Busca en cache de Supabase si existe consulta en las ultimas 24h.
3. Si no existe cache, consulta API oficial de Hacienda.
4. Guarda respuesta normalizada en Supabase.
5. Devuelve JSON consistente al frontend.

## Gratis primero

- Puedes usar el plan gratuito de Supabase para iniciar.
- Puedes desplegar gratis en Vercel/Netlify (con limites de uso).
- El caché reduce costos de llamadas y mejora rendimiento.
