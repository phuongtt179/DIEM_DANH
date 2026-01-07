import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'

const inter = Inter({ subsets: ['latin', 'vietnamese'] })

export const metadata: Metadata = {
  title: 'Quản lý Lớp học & Điểm danh',
  description: 'Ứng dụng quản lý lớp dạy thêm, điểm danh và thu học phí',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="vi">
      <body className={inter.className}>
        <div className="flex h-screen bg-gray-50">
          <Sidebar />
          <main className="flex-1 overflow-y-auto pt-16 pb-16 lg:pt-0 lg:pb-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
