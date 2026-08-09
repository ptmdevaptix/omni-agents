'use client';

import Image from 'next/image';
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
    { href: '/admin/research', label: 'Research' },
    { href: '/admin/content', label: 'Content' },
    { href: '/admin/prompts', label: 'Prompts' },
    { href: '/admin/relevance', label: 'Relevance' },
  ];

  return (
    <nav className="border-b px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/articles" className="flex items-center gap-2">
          <Image
            src="/omni-logo.png"
            alt="Omni Hockey"
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
            priority
          />
          <span className="text-lg font-semibold tracking-tight text-white whitespace-nowrap">
            Omni Hockey
          </span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Admin
          </span>
        </Link>
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
