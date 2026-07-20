// Worker entry point. Routing (OAuth, MCP, upload/preview pages) is wired in a
// later task; this placeholder keeps wrangler.toml's `main` resolvable so the
// vitest-pool-workers runtime can bundle a Worker for the test isolate.
const handler: ExportedHandler<Env> = {
  async fetch() {
    return new Response("Nog nie beskikbaar nie.", { status: 404 });
  },
};

export default handler;
