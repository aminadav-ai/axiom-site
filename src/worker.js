export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.axiom-lang.org') {
      url.hostname = 'axiom-lang.org';
      return Response.redirect(url.toString(), 301);
    }

    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    headers.set(
      'Permissions-Policy',
      'camera=(), geolocation=(), microphone=(), focus-without-user-activation=()'
    );
    headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    headers.set('Strict-Transport-Security', 'max-age=300; includeSubDomains');
    headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'self'; object-src 'none'; base-uri 'self';"
    );

    if (url.pathname.endsWith('.wasm')) {
      headers.set('Content-Type', 'application/wasm');
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
};
