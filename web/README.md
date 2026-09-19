# PRISM web demo

This is the official `create-next-app` App Router frontend for PRISM. The live
demo calls `/api/mask`, a Next.js Route Handler that proxies to the real PRISM
HTTP service.

From the repository root:

```powershell
npm run prism:serve
npm run web:dev
```

Open `http://localhost:3000`, type text, and select **Done**. The editor uses
the returned PRISM detection offsets to highlight values, while the output
panel renders typed placeholders such as `[EMAIL]`.

To point the proxy at another backend, create `web/.env.local`:

```dotenv
PRISM_API_URL=http://127.0.0.1:8787
```

Production build:

```powershell
npm run web:build
npm run web:start
```
