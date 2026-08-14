# williammuli.dev

Personal site for William Muli — built with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com), deployed on [Cloudflare Workers](https://workers.cloudflare.com).

## Stack

- **Astro** (server output) with static prerendering on every page except the chat API
- **Tailwind CSS v4**
- **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`) powering the "ask me anything" chat widget, grounded in real CV/experience data (`src/data/cv-context.ts`)
- **Cloudflare Workers** via `@astrojs/cloudflare`, with a simple in-memory rate limiter on `/api/chat`

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # add your own ANTHROPIC_API_KEY
npm run dev
```

To test against the real Workers runtime locally (recommended before deploying):

```sh
npm run build
npx wrangler dev
```

## Deployment

Deploys to Cloudflare Workers. Either push to `main` (if the repo is connected to a Cloudflare Workers Builds project) or deploy manually:

```sh
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

## Project structure

```text
src/
├── components/     # Nav, Footer, ChatBox, ProjectRow, HoverInfo, AsciiBackground
├── data/           # site copy, work history, CV context for the chat assistant
├── lib/            # rate limiting
├── layouts/        # shared page shell
└── pages/
    ├── index.astro
    ├── writing/    # long-form posts
    └── api/chat.ts # streaming AI assistant endpoint
```
