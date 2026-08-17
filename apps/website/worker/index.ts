interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.beisammen.app') {
      url.hostname = 'beisammen.app';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
