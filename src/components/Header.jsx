import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-3 md:gap-0">
        <Link to="/" className="text-xl md:text-2xl font-bold text-blue-800">
          法政通信メディア
        </Link>
        <nav>
          <ul className="flex space-x-4 md:space-x-6 text-sm font-medium">
            <li><Link to="/" className="hover:text-blue-600 transition">ホーム</Link></li>
            <li><Link to="/qa" className="hover:text-blue-600 transition">Q&A</Link></li>
            <li><Link to="/contact" className="hover:text-blue-600 transition">お問い合わせ</Link></li>
          </ul>
        </nav>
      </div>
    </header>
  );
}