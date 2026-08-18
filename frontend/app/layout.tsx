import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SocketProvider } from '@/components/providers/SocketProvider';

/**
 * Root shell — a server component. Everything realtime lives below
 * SocketProvider, which is the single client boundary for the app.
 */

export const metadata: Metadata = {
  title: 'KJS-SRS-01 · SomaiyaSat Mission Control',
  description:
    'Simulated mission control dashboard for the KJS-SRS-01 SomaiyaSat & SomaiyaPod PocketQube demonstrator. Simulation only — no real spacecraft or RF hardware.',
};

export const viewport: Viewport = {
  themeColor: '#080c11',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full bg-void font-sans text-ink antialiased">
        <SocketProvider>{children}</SocketProvider>
      </body>
    </html>
  );
}