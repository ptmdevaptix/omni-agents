import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Both of these are static with no logic, and Next's own guidance is to redirect before the
    // render process rather than from a component when that is the case
    // (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md).
    return [
      // The root served the create-next-app scaffold — Next.js logo, "To get started, edit the
      // page.tsx file" — since the initial commit, and the auth proxy only covers /articles and
      // /admin, so that template was the publicly reachable face of the deployment. /articles is
      // the real landing and already where login sends you.
      { source: "/", destination: "/articles", permanent: false },
      // /admin had no page of its own, only subdirectories, so the obvious URL to type 404'd. No
      // hub page: the nav is on every admin screen already.
      { source: "/admin", destination: "/admin/research", permanent: false },
    ];
  },
};

export default nextConfig;
