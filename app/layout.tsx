import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, DM_Sans } from 'next/font/google';
import './globals.css';

// The display pair: Cormorant Garamond for headings and the "atelier" voice, DM Sans for small UI text.
const serif = Cormorant_Garamond({ variable: '--font-serif', subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600'] });
const sans = DM_Sans({ variable: '--font-sans', subsets: ['latin', 'latin-ext'] });

export const metadata: Metadata = {
  title: 'Physio Atlas — interactive 3D muscles and movement',
  description: 'Explore every muscle and bone in 3D, move each joint through its range, and see which muscles act.',
};

export const viewport: Viewport = { themeColor: '#f7f0e7', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
