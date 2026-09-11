import { redirect } from 'next/navigation';

/**
 * The site root.
 *
 * This was still the create-next-app scaffold — Next.js logo, "To get started, edit the page.tsx
 * file" — and because the auth proxy only matches /articles and /admin, that template was the
 * publicly reachable face of the deployment. There is no separate home page to build: /articles is
 * the landing, and it is already where login sends you.
 */
export default function Home() {
  redirect('/articles');
}
