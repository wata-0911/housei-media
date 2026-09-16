import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center bg-[#FAFAFA] px-4">
      <div className="text-center">
        <p className="text-sm tracking-[0.2em] text-[#E65C00] mb-4">
          404
        </p>

        <h1 className="text-3xl md:text-4xl text-[#002255] font-medium mb-6">
          ページが見つかりません
        </h1>

        <p className="text-[#666666] mb-8">
          URLが変更されたか、ページが削除された可能性があります。
        </p>

        <Link
          to="/"
          className="inline-block bg-[#E65C00] hover:bg-[#CC5200] text-white px-6 py-3 rounded-md transition-colors"
        >
          トップページへ戻る
        </Link>
      </div>
    </div>
  )
}