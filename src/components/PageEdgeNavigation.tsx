
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

type ScrollState = {
    atTop: boolean;
    canScroll: boolean;
    bottomOffset: number;
};

function scrollBehavior(): ScrollBehavior {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth';
}

export default function PageEdgeNavigation() {
    const { pathname } = useLocation();
    const isPlanner = pathname.replace(/\/+$/, '') === '/planner';

    const [scrollState, setScrollState] = useState<ScrollState>({
        atTop: true,
        canScroll: false,
        bottomOffset: 16,
    });

    useEffect(() => {
        let frame = 0;

        const update = () => {
            frame = 0;

            const pageHeight = Math.max(
                document.documentElement.scrollHeight,
                document.body.scrollHeight,
            );

            const footer = document.querySelector('footer');
            const footerOverlap = footer
                ? Math.max(0, window.innerHeight - footer.getBoundingClientRect().top)
                : 0;

            const next: ScrollState = {
                atTop: window.scrollY <= 24,
                canScroll: pageHeight > window.innerHeight + 8,
                bottomOffset: 16 + footerOverlap,
            };

            setScrollState(previous =>
                previous.atTop === next.atTop &&
                    previous.canScroll === next.canScroll &&
                    previous.bottomOffset === next.bottomOffset
                    ? previous
                    : next
            );
        };

        const scheduleUpdate = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(update);
        };

        scheduleUpdate();

        window.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate);

        const observer = new ResizeObserver(scheduleUpdate);
        observer.observe(document.body);

        return () => {
            window.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
            observer.disconnect();
            window.cancelAnimationFrame(frame);
        };
    }, [pathname]);

    function moveToEdge() {
        const pageHeight = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
        );

        window.scrollTo({
            top: scrollState.atTop
                ? Math.max(0, pageHeight - window.innerHeight)
                : 0,
            behavior: scrollBehavior(),
        });
    }

    function moveToCourseSearch() {
        const input = document.getElementById('course-query');

        // メディア・プロフィールタブの場合は年間履修計画へ切り替える。
        if (!input) {
            const annualTab = document.getElementById('annual-tab');
            if (annualTab instanceof HTMLButtonElement) {
                if (annualTab.disabled) return;
                annualTab.click();
            }
        }

        window.requestAnimationFrame(() => {
            const search = document.getElementById('course-query');
            if (!(search instanceof HTMLInputElement)) return;

            search.scrollIntoView({
                behavior: scrollBehavior(),
                block: 'start',
            });
            search.focus({ preventScroll: true });
        });
    }

    if (!scrollState.canScroll && !isPlanner) return null;

    return (
        <div
            className="fixed right-4 z-40 flex flex-col items-end gap-2"
            style={{
                bottom: `calc(${scrollState.bottomOffset}px + env(safe-area-inset-bottom))`,
                fontFamily: '"Noto Serif JP", serif',
            }}
        >
            {isPlanner && (
                <button
                    type="button"
                    onClick={moveToCourseSearch}
                    className="
          min-h-11 rounded-full border border-gray-300
          bg-white px-4 py-2
          text-sm tracking-widest font-light text-[#002255]
          shadow-lg
          hover:bg-[#002255] hover:text-[#E65C00]
          transition-colors duration-300
          focus-visible:outline focus-visible:outline-2
          focus-visible:outline-offset-2 focus-visible:outline-blue-600
        "
                >
                    科目検索へ戻る
                </button>
            )}

            {scrollState.canScroll && (
                <button
                    type="button"
                    onClick={moveToEdge}
                    className="
          min-h-11 rounded-full
          bg-[#002255] px-4 py-2
          text-sm tracking-widest font-light text-white
          shadow-lg
          hover:text-[#E65C00]
          transition-colors duration-300
          focus-visible:outline focus-visible:outline-2
          focus-visible:outline-offset-2 focus-visible:outline-blue-600
        "
                >
                    {scrollState.atTop
                        ? '↓ ページ下部へ'
                        : '↑ ページ上部へ'}
                </button>
            )}
        </div>
    );

}
