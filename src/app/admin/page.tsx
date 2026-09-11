import { redirect } from 'next/navigation';

/**
 * /admin itself had no page, only subdirectories, so the obvious URL to type 404'd. Send it to the
 * first section rather than building a hub nobody asked for — the nav is already on every admin page.
 */
export default function AdminIndex() {
  redirect('/admin/research');
}
