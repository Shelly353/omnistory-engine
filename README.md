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

## Supabase setup

Run `supabase/schema.sql` in the Supabase SQL editor. The frontend does not use Supabase keys directly; the Express backend uses the service role key.

## Render

Connect this repository to Render and use the included `render.yaml` blueprint. Set the secret environment variables in Render.
