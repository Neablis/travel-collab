import { Analytics } from '@vercel/analytics/next';

export const metadata = { title: "travel-collab" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", margin: "2rem auto", maxWidth: 640 }}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
