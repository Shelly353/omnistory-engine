# Novel Workflow Studio

MVP for producing long-form AI novels with a controlled continuity workflow:

Concept -> Story Bible -> Canon -> Six Beats -> Event Chain -> Chapter Contracts -> Draft -> Audit -> State Snapshots.

## Local setup

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

The app is compatible with the original OmniStory Render variables:

```bash
DEEPSEEK_API_KEY=...
OMNISTORY_ACCESS_TOKEN=...
AI_RATE_LIMIT_PER_MINUTE=20
ALLOWED_ORIGINS=https://your-service.onrender.com
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
AI_MODEL=deepseek-v4-flash
AI_BASE_URL=https://api.deepseek.com
```

`SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY`, and `APP_ACCESS_TOKEN` are optional aliases. If both old and new names exist, the OmniStory-compatible names are preferred for access control and DeepSeek key lookup.

## Supabase setup

Run `supabase/schema.sql` in the Supabase SQL editor. The frontend does not use Supabase keys directly; the Express backend uses `SUPABASE_SERVICE_ROLE_KEY` when available, otherwise it falls back to the original OmniStory `SUPABASE_ANON_KEY`.

## Render

Connect this repository to Render and use the included `render.yaml` blueprint. Set the secret environment variables in Render.
