import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Golf Designer',
  description: 'Freehand golf hole designer',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
