// The server is bundled into api/_app.mjs at build time (Vercel's Node runtime needs full ESM paths).
// @ts-ignore generated file
import { app } from './_app.mjs';
export const config = { runtime: 'nodejs', maxDuration: 300 };
export default { fetch: (request: Request) => app.fetch(request, process.env) };
