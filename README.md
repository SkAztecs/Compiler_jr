# Native Language Compiler

A teaching compiler for a small language whose keywords can be written in Tamil, Hindi,
Telugu, Kannada, Malayalam, Bengali, Marathi or English. It shows every compiler phase
(tokens, syntax tree, symbols, three-address code, optimizer, bytecode, VM), and includes
a step-through debugger, a complexity advisor and C / Python / JavaScript output.

```
npm install
npm run dev     # then open the address it prints
npm test        # 100+ tests (Python and C checks run if python and gcc are installed)
```

## AI tutor (optional)

The "Explain this error" and "Explain line N" buttons ask Claude (claude-haiku-5-5 by
default, about $0.0007 per explanation) to explain things in the student's language,
using what the compiler has already worked out. Everything else works without it.

1. Get an API key at https://console.anthropic.com, and set a monthly spending limit there.
2. Copy `.env.example` to `.env.local` and put the key after `ANTHROPIC_API_KEY=`.
3. Restart `npm run dev`.

The key is only read by the dev server (`server/tutor.js`); it is never sent to the browser,
and `.env.local` is ignored by Git, so it is never uploaded. Never put the key anywhere else.
Repeated questions reuse saved answers, and each browser can ask 6 questions a minute
(300 a day in total, see `TUTOR_DAILY_LIMIT`).

## Putting it online with the AI tutor (Cloudflare)

The app is plain files, and the tutor runs on Cloudflare (see `server/cloudflare.js`),
so the key stays on Cloudflare and never reaches the browser. It works as a Worker
(`wrangler.jsonc` and `server/worker.js`) or as a Pages project (`functions/api/`).

1. At https://dash.cloudflare.com go to **Workers & Pages → Create**, import this repository,
   and name the Worker `compiler-jr` (the name in `wrangler.jsonc`; change one or the other
   so they match).
2. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
   (For a Pages project instead: build output directory `dist`, no deploy command.)
3. In the project's **Settings → Variables and Secrets**, add `ANTHROPIC_API_KEY` as a
   **Secret**. Also add `TUTOR_ACCESS_CODE` (a code you give your class), so strangers who
   find the link can't spend the key. Then deploy again so the settings are used.
4. In the Anthropic console, set a monthly spending limit. Cloudflare runs many short-lived
   copies of the functions, so the saved answers and rate limits only reduce the cost;
   the spending limit is what caps it.

Every push to `main` deploys again. Without `ANTHROPIC_API_KEY` the site still works,
and the Explain box says the tutor is not set up.

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
