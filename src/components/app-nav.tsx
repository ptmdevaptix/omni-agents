'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const links = [
    { href: '/articles', label: 'Articles' },
    { href: '/admin/feeds', label: 'Manage Feeds' },
  ];

  return (
    <nav className="border-b px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <span className="font-semibold text-sm">Omni Agents</span>
        <div className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                pathname.startsWith(link.href)
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={handleLogout}>
        Logout
      </Button>
    </nav>
  );
}
