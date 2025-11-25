'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ScanLine, PackageCheck, UserCheck, UserPlus } from 'lucide-react';
import Image from 'next/image';

const navLinks = [
  { href: '/', label: 'Asignar', icon: <UserCheck className="h-5 w-5" /> },
  { href: '/calificar', label: 'Calificar', icon: <ScanLine className="h-5 w-5" /> },
  { href: '/entrega', label: 'Entrega', icon: <PackageCheck className="h-5 w-5" /> },
  { href: '/registro-personal', label: 'Registrar Personal', icon: <UserPlus className="h-5 w-5" /> },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-starbucks-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="flex-shrink-0">
                <Image src="https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnQ4MGZzdXYzYWo1cXRiM3I1cjNoNjd4cjdia202ZXcwNjJ6YjdvbiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/QQO6BH98nhigF8FLsb/giphy.gif" alt="Logo" width={40} height={40} />
            </Link>
          </div>
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-4">
              {navLinks.map((link) => {
                const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-starbucks-green text-white'
                        : 'text-starbucks-dark hover:bg-starbucks-cream hover:text-starbucks-dark'
                    )}
                  >
                    {link.icon}
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="md:hidden">
            {/* Mobile menu button could go here */}
          </div>
        </div>
      </div>
    </nav>
  );
}
