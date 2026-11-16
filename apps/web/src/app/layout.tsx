import './globals.css';
import type { Metadata, Viewport } from 'next';
import { PwaRegister } from '@/components/PwaRegister';

export const metadata: Metadata = {
  title: 'E-QA — Kartu, Kantin, dan Tagihan Pesantren',
  description: 'Sistem kartu santri, kantin cashless, dan pembayaran SPP (MODE DEMO)',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'E-QA', statusBarStyle: 'default' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0B2040' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}<PwaRegister /></body>
    </html>
  );
}
