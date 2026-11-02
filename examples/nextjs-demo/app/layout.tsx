import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'nepal-pay Next.js demo' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <p className="note">Local sandbox demo. Orders live in memory; do not deploy this as is.</p>
        {children}
      </body>
    </html>
  );
}
