export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    const showDevelopBadge = url.pathname === '/' && env.GEOLINT_ENV === 'develop';
    if (!showDevelopBadge) return response;

    return new HTMLRewriter().on('.environment-badge', {
      element(element) {
        element.removeAttribute('hidden');
      },
    }).transform(response);
  },
};
