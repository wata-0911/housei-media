// The assembler prepends the exact hosts, asset destinations and response headers.
function denied(method) {
  return new Response(method === 'HEAD' ? null : 'Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...contract.deny },
  });
}

async function asset(url, method, target, headers, env) {
  const internal = new URL(target, url.origin);
  const response = await env.ASSETS.fetch(new Request(internal, { method, redirect: 'manual' }));
  if (response.status !== 200) return denied(method);
  const output = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) output.set(name, value);
  return new Response(method === 'HEAD' ? null : response.body, { headers: output });
}

const privateParentPaths = /^\/(?:planner(?:\.html)?|child|_planner-child|release-child|_worker\.js|_routes\.json)(?:\/|$)/i;

export default {
  fetch(request, env) {
    const { method } = request;
    if (method !== 'GET' && method !== 'HEAD') return denied(method);
    const url = new URL(request.url);
    const path = url.pathname;
    if (contract.kind === 'child') {
      const route = Object.hasOwn(contract.routes, path) && contract.routes[path];
      return url.origin === contract.origin && route
        ? asset(url, method, route.dest, route.headers, env)
        : denied(method);
    }
    if (url.origin === contract.origin && (path === '/planner' || path === '/planner/')) {
      return asset(url, method, '/', contract.planner, env);
    }
    if (privateParentPaths.test(path) || path.includes('%') || path.startsWith('/assets/')) {
      return denied(method);
    }
    return asset(url, method, '/', {}, env);
  },
};
