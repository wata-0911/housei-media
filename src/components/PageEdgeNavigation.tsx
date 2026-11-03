import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './PageEdgeNavigation.css';

const destinations = [
    ['course-query', '科目検索へ'],
    ['graduation-progress-heading', '卒業要件へ'],
    ['planned-heading', '履修・修得一覧へ'],
    ['media-panel', 'メディア記録へ'],
] as const;
const WIDTH = 304, HEIGHT = 224;
type Point = { x: number; y: number };
type Position = Point & { width: number; height: number; compact: boolean; overlay: boolean };
type Gesture = { id: number; start: Point; origin: Point; mode: 'pending' | 'select' | 'drag' | 'cancelled'; timer: number; moved: boolean };

export default function PageEdgeNavigation() {
    const location = useLocation();
    const navigate = useNavigate();
    const root = useRef<HTMLDivElement>(null);
    const toggle = useRef<HTMLButtonElement>(null);
    const gesture = useRef<Gesture | null>(null);
    const suppressClick = useRef(false);
    const pressOpen = useRef(false);
    const openRef = useRef(false);
    const [position, setPosition] = useState<Position | null>(null);
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [scroll, setScroll] = useState({ atTop: true, canScroll: false });

    const changeOpen = useCallback((value: boolean) => {
        openRef.current = value;
        setOpen(value);
    }, []);
    const close = useCallback((restore = false) => {
        if (root.current?.contains(document.activeElement) &&
            (restore || root.current.querySelector('.edge-shortcuts')?.contains(document.activeElement))) {
            toggle.current?.focus({ preventScroll: true });
        }
        changeOpen(false);
        setSelected(null);
    }, [changeOpen]);
    function clamp(point: Point): Position {
        const view = window.visualViewport;
        const left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
        const width = view?.width ?? innerWidth, height = view?.height ?? innerHeight;
        const probe = root.current?.querySelector('.edge-safe-area');
        const safe = probe ? getComputedStyle(probe) : null;
        const minX = left + 8 + parseFloat(safe?.paddingLeft || '0');
        const safeTop = top + 8 + parseFloat(safe?.paddingTop || '0');
        const maxRight = left + width - 8 - parseFloat(safe?.paddingRight || '0');
        const maxBottom = top + height - 8 - parseFloat(safe?.paddingBottom || '0');
        const belowHeader = Math.max(safeTop, (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0) + 8);
        const compact = maxRight - minX < WIDTH || maxBottom - belowHeader < HEIGHT;
        // If the header leaves less than two list rows plus the controls, use a
        // viewport panel above the header instead of shrinking text or hit areas.
        const overlay = compact && maxBottom - belowHeader < 132;
        const minY = overlay ? safeTop : belowHeader;
        const panelWidth = Math.min(WIDTH, maxRight - minX);
        const panelHeight = compact ? Math.min(HEIGHT, maxBottom - minY) : HEIGHT;
        const footerTop = document.querySelector('footer')?.getBoundingClientRect().top ?? maxBottom;
        const bottom = Math.min(maxBottom, Math.max(minY + panelHeight, footerTop - 8));
        return {
            x: Math.max(minX, Math.min(point.x, maxRight - panelWidth)),
            y: Math.max(minY, Math.min(point.y, bottom - panelHeight)),
            width: panelWidth, height: panelHeight, compact, overlay,
        };
    }

    useEffect(() => {
        let frame = 0;
        const update = () => {
            frame = 0;
            const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
            setScroll(previous => {
                const next = { atTop: scrollY <= 24, canScroll: height > innerHeight + 8 };
                return previous.atTop === next.atTop && previous.canScroll === next.canScroll ? previous : next;
            });
            setPosition(previous => {
                const next = clamp(previous ?? { x: innerWidth - WIDTH - 16, y: innerHeight - HEIGHT - 16 });
                return previous?.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height && previous.compact === next.compact && previous.overlay === next.overlay ? previous : next;
            });
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
        const cancel = () => {
            if (gesture.current) { clearTimeout(gesture.current.timer); gesture.current.mode = 'cancelled'; suppressClick.current = true; }
            close(); schedule();
        };
        const outside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                if (!gesture.current) suppressClick.current = false;
                return;
            }
            if (event.defaultPrevented || (!openRef.current && !gesture.current)) return;
            // close() restores only menu-owned focus; external inputs keep theirs.
            cancel();
        };
        schedule();
        window.addEventListener('scroll', cancel, { passive: true });
        window.addEventListener('resize', cancel);
        window.visualViewport?.addEventListener('resize', cancel);
        window.visualViewport?.addEventListener('scroll', cancel);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        const observer = new ResizeObserver(schedule);
        observer.observe(document.body);
        return () => {
            window.removeEventListener('scroll', cancel); window.removeEventListener('resize', cancel);
            window.visualViewport?.removeEventListener('resize', cancel); window.visualViewport?.removeEventListener('scroll', cancel);
            document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
            observer.disconnect(); cancelAnimationFrame(frame);
            if (gesture.current) clearTimeout(gesture.current.timer);
        };
    }, [close]);
    useEffect(() => {
        const frame = requestAnimationFrame(() => close());
        return () => cancelAnimationFrame(frame);
    }, [location.key, close]);

    function choose(index: number) {
        close(true);
        // A fresh Router key also handles selecting the current hash again.
        navigate(`/planner#${destinations[index][0]}`);
    }
    function start(event: PointerEvent<HTMLButtonElement>, drag = false) {
        if (!event.isPrimary || event.button !== 0 || !position) return;
        suppressClick.current = false;
        pressOpen.current = open;
        const current: Gesture = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: position, mode: drag ? 'drag' : 'pending', timer: 0, moved: false };
        gesture.current = current;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (drag) close();
        else if (event.pointerType !== 'mouse') current.timer = window.setTimeout(() => {
            if (gesture.current !== current || current.mode !== 'pending') return;
            // Compact lists require a separate tap: sliding cannot safely select
            // among clipped / scrollable rows. Keep the tap alternative open.
            current.mode = position.compact ? 'cancelled' : 'select';
            suppressClick.current = true; changeOpen(true);
        }, 450);
    }
    function move(event: PointerEvent<HTMLButtonElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
        if (Math.hypot(dx, dy) > 10) {
            current.moved = true;
            if (current.mode === 'pending') { clearTimeout(current.timer); current.mode = 'cancelled'; suppressClick.current = true; }
        }
        if (current.mode === 'drag') {
            suppressClick.current = true;
            setPosition(clamp({ x: current.origin.x + dx, y: current.origin.y + dy }));
        }
        if (current.mode === 'select') {
            // Only release over a visible labelled target commits the gesture.
            const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('[data-edge-destination]');
            setSelected(hit ? Number(hit.dataset.edgeDestination) : null);
        }
    }
    function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        clearTimeout(current.timer); gesture.current = null;
        if (current.mode === 'select') {
            const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('[data-edge-destination]');
            if (!cancelled && hit) choose(Number(hit.dataset.edgeDestination));
            else close(true);
        }
        if (current.mode === 'drag' || cancelled) { suppressClick.current = true; close(); }
    }
    const handlers = { onPointerMove: move, onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event), onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finish(event, true), onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finish(event, true) };
    const consumeClick = (detail: number) => {
        const suppressed = suppressClick.current;
        suppressClick.current = false;
        return detail !== 0 && suppressed;
    };

    return <div ref={root} className={`page-edge-navigation ${open ? 'is-open' : ''} ${position?.compact ? 'is-compact' : ''}`} role="navigation" aria-label="ページ移動"
        style={{ left: position?.x ?? 8, top: position?.y ?? 180, visibility: position ? 'visible' : 'hidden', width: position?.width, height: position?.compact && !open ? 44 : position?.height, zIndex: position?.overlay ? 60 : 40 }}
        onPointerEnter={event => { if (event.pointerType === 'mouse' && !gesture.current) changeOpen(true); }}
        onPointerLeave={event => { if (event.pointerType === 'mouse' && !gesture.current && !root.current?.contains(document.activeElement)) close(); }}
        onFocus={event => { if (!gesture.current && !suppressClick.current && !event.currentTarget.contains(event.relatedTarget)) changeOpen(true); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
        <span className="edge-safe-area" aria-hidden="true" />
        <div className="edge-center">
            <button type="button" className="edge-drag" aria-label="ナビを移動（矢印キーでも移動できます）" onPointerDown={event => start(event, true)} {...handlers}
                onKeyDown={event => {
                    const delta: Record<string, Point> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } };
                    if (position && delta[event.key]) { event.preventDefault(); setPosition(clamp({ x: position.x + delta[event.key].x, y: position.y + delta[event.key].y })); }
                }}>⠿ 移動</button>
            {scroll.canScroll && <button type="button" className="edge-scroll" onPointerDown={event => start(event)} {...handlers} onClick={event => {
                if (consumeClick(event.detail)) return;
                close();
                window.scrollTo({ top: scroll.atTop ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - innerHeight : 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
            }}>{scroll.atTop ? '↓ ページ下部へ' : '↑ ページ上部へ'}</button>}
            <button ref={toggle} type="button" aria-expanded={open} aria-controls="edge-shortcuts" className="edge-toggle" onPointerDown={event => start(event)} {...handlers}
                onClick={event => { if (!consumeClick(event.detail)) { if (event.detail === 0 ? open : pressOpen.current) close(); else changeOpen(true); } }}>ショートカット</button>
        </div>
        <div id="edge-shortcuts" className="edge-shortcuts" role="group" aria-label={position?.compact ? 'ショートカット一覧（スクロールできます）' : 'ショートカット一覧'} hidden={!open}>
            {destinations.map(([id, label], index) => <button key={id} type="button" data-edge-destination={index} className={`edge-destination edge-destination-${index} ${selected === index ? 'is-selected' : ''}`} onClick={() => choose(index)}>{label}</button>)}
        </div>
    </div>;
}
