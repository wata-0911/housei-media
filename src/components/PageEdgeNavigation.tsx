import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './PageEdgeNavigation.css';

const destinations = [
    ['course-query', '科目検索へ'],
    ['graduation-progress-heading', '卒業要件へ'],
    ['planned-heading', '履修・修得一覧へ'],
    ['media-panel', 'メディア記録へ'],
] as const;
const LONG_PRESS_MS = 450, DRAG_DISTANCE = 12;
const MENU_WIDTH = 304, MENU_HEIGHT = 224, LIST_HEIGHT = 4 * 44 + 2, GAP = 8;
type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Bounds = { left: number; top: number; right: number; bottom: number; headerBottom: number };
type Frame = { position: Point; size: Size; bounds: Bounds };
type Gesture = { id: number; start: Point; origin: Point; mode: 'pending' | 'drag' | 'select' | 'menu' | 'cancelled'; timer: number };
const between = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
function clamp(point: Point, size: Size, bounds: Bounds): Point {
    return { x: between(point.x, bounds.left, bounds.right - size.width), y: between(point.y, bounds.top, bounds.bottom - size.height) };
}

// The button owns its position. The menu finds its own space without reducing
// the button's movement range. Only a very short viewport needs a list overlay.
function menuLayout({ position, size, bounds }: Frame) {
    const radial = { x: position.x - (MENU_WIDTH - size.width) / 2, y: position.y - 90, width: MENU_WIDTH, height: MENU_HEIGHT };
    const belowHeader = Math.max(bounds.top, bounds.headerBottom + GAP);
    if (radial.x >= bounds.left && radial.x + radial.width <= bounds.right && radial.y >= belowHeader && radial.y + radial.height <= bounds.bottom) {
        return { ...radial, compact: false, anchor: position };
    }
    const width = Math.min(MENU_WIDTH, bounds.right - bounds.left);
    const x = between(position.x + (size.width - width) / 2, bounds.left, bounds.right - width);
    const below = Math.max(position.y + size.height + GAP, belowHeader);
    const above = position.y - GAP - belowHeader;
    if (Math.max(bounds.bottom - below, above) >= 44) {
        const down = bounds.bottom - below >= above;
        const height = Math.min(LIST_HEIGHT, down ? bounds.bottom - below : above);
        return { x, y: down ? below : position.y - GAP - height, width, height, compact: true, anchor: position };
    }
    // Prefer the safe viewport space when the header occupies most of it.
    const safeBelow = position.y + size.height + GAP;
    const safeAbove = position.y - GAP - bounds.top;
    if (Math.max(bounds.bottom - safeBelow, safeAbove) >= 44) {
        const down = bounds.bottom - safeBelow >= safeAbove;
        const height = Math.min(LIST_HEIGHT, down ? bounds.bottom - safeBelow : safeAbove);
        return { x, y: down ? safeBelow : position.y - GAP - height, width, height, compact: true, anchor: position };
    }
    // At still smaller available heights, temporarily dock the open control at
    // the top. Closing restores the stored position; text and targets never scale.
    const anchor = { x: position.x, y: bounds.top };
    const y = bounds.top + size.height + GAP;
    return { x, y, width, height: Math.min(LIST_HEIGHT, bounds.bottom - y), compact: true, anchor };
}

export default function PageEdgeNavigation({ plannerPath = '/planner', includeMedia = true }: { plannerPath?: string; includeMedia?: boolean }) {
    const availableDestinations = includeMedia ? destinations : destinations.slice(0, -1);
    const location = useLocation();
    const navigate = useNavigate();
    const root = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const gesture = useRef<Gesture | null>(null);
    const suppressClick = useRef(false);
    const physicalTap = useRef(false);
    const openRef = useRef(false);
    const [frame, setFrame] = useState<Frame | null>(null);
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [scroll, setScroll] = useState({ atTop: true, canScroll: false });
    const changeOpen = useCallback((value: boolean) => { openRef.current = value; setOpen(value); }, []);
    const close = useCallback(() => {
        if (root.current?.querySelector('.edge-shortcuts')?.contains(document.activeElement)) button.current?.focus({ preventScroll: true });
        changeOpen(false); setSelected(null);
    }, [changeOpen]);
    const cancelGesture = useCallback(() => {
        physicalTap.current = false;
        if (gesture.current) {
            clearTimeout(gesture.current.timer); gesture.current.mode = 'cancelled'; suppressClick.current = true;
        }
    }, []);

    useEffect(() => {
        let raf = 0;
        const update = () => {
            raf = 0;
            const view = window.visualViewport, safe = root.current?.querySelector('.edge-safe-area');
            const padding = safe ? getComputedStyle(safe) : null;
            const left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
            const bounds: Bounds = {
                left: left + GAP + parseFloat(padding?.paddingLeft || '0'),
                top: top + GAP + parseFloat(padding?.paddingTop || '0'),
                right: left + (view?.width ?? innerWidth) - GAP - parseFloat(padding?.paddingRight || '0'),
                bottom: top + (view?.height ?? innerHeight) - GAP - parseFloat(padding?.paddingBottom || '0'),
                headerBottom: document.querySelector('header')?.getBoundingClientRect().bottom ?? 0,
            };
            const size = { width: Math.min(128, bounds.right - bounds.left), height: button.current?.offsetHeight || 44 };
            setFrame(previous => {
                const position = clamp(previous?.position ?? { x: bounds.right - size.width - GAP, y: bounds.bottom - size.height - GAP }, size, bounds);
                const next = { position, size, bounds };
                return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
            });
            const next = { atTop: scrollY <= 24, canScroll: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) > innerHeight + 8 };
            setScroll(previous => previous.atTop === next.atTop && previous.canScroll === next.canScroll ? previous : next);
        };
        const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
        const cancel = () => { cancelGesture(); close(); schedule(); };
        const outside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
        const keydown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') { if (!gesture.current) suppressClick.current = false; return; }
            if (event.defaultPrevented || (!openRef.current && !gesture.current)) return;
            cancel();
        };
        schedule();
        window.addEventListener('scroll', cancel, { passive: true });
        window.addEventListener('resize', cancel);
        window.visualViewport?.addEventListener('resize', cancel);
        window.visualViewport?.addEventListener('scroll', cancel);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', keydown);
        const observer = new ResizeObserver(schedule);
        observer.observe(document.body);
        if (button.current) observer.observe(button.current);
        return () => {
            window.removeEventListener('scroll', cancel); window.removeEventListener('resize', cancel);
            window.visualViewport?.removeEventListener('resize', cancel); window.visualViewport?.removeEventListener('scroll', cancel);
            document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown);
            observer.disconnect(); cancelAnimationFrame(raf); cancelGesture();
        };
    }, [cancelGesture, close]);
    useEffect(() => {
        const raf = requestAnimationFrame(() => { cancelGesture(); close(); });
        return () => cancelAnimationFrame(raf);
    }, [location.key, cancelGesture, close]);

    const menu = frame ? menuLayout(frame) : null;
    const anchor = open && menu ? menu.anchor : frame?.position;
    function choose(index: number) { close(); navigate(`${plannerPath}#${availableDestinations[index][0]}`); }
    function moveToEdge(edge = scroll.atTop ? 'bottom' : 'top') {
        close();
        window.scrollTo({ top: edge === 'bottom' ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - innerHeight : 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
    function start(event: PointerEvent<HTMLButtonElement>) {
        if (!event.isPrimary || event.button !== 0 || !frame || !anchor) return;
        suppressClick.current = false; physicalTap.current = false;
        const current: Gesture = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: anchor, mode: 'pending', timer: 0 };
        gesture.current = current;
        setFrame({ ...frame, position: anchor });
        close(); event.currentTarget.setPointerCapture(event.pointerId);
        current.timer = window.setTimeout(() => {
            if (gesture.current !== current || current.mode !== 'pending') return;
            current.mode = menu?.compact && menu.height < LIST_HEIGHT ? 'menu' : 'select';
            suppressClick.current = true; changeOpen(true);
        }, LONG_PRESS_MS);
    }
    function hitItem(x: number, y: number) {
        const hit = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('[data-edge-destination]');
        return hit && root.current?.contains(hit) ? Number(hit.dataset.edgeDestination) : null;
    }
    function move(event: PointerEvent<HTMLButtonElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId || !frame) return;
        const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
        if (current.mode === 'pending' && Math.hypot(dx, dy) >= DRAG_DISTANCE) {
            clearTimeout(current.timer); current.mode = 'drag'; suppressClick.current = true; close();
        }
        if (current.mode === 'drag') {
            setFrame({ ...frame, position: clamp({ x: current.origin.x + dx, y: current.origin.y + dy }, frame.size, frame.bounds) });
        }
        if (current.mode === 'select') setSelected(hitItem(event.clientX, event.clientY));
        if (current.mode !== 'pending' && event.cancelable) event.preventDefault();
    }
    function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        clearTimeout(current.timer); gesture.current = null;
        if (cancelled || current.mode === 'cancelled' || current.mode === 'drag') { suppressClick.current = true; close(); return; }
        if (current.mode === 'pending') physicalTap.current = true;
        if (current.mode === 'select' || current.mode === 'menu') {
            suppressClick.current = true; setSelected(null);
            const index = hitItem(event.clientX, event.clientY);
            if (current.mode === 'select' && index !== null) choose(index);
            else {
                const hit = document.elementFromPoint(event.clientX, event.clientY);
                if (!root.current?.contains(hit)) close();
                // Release over the central button leaves the menu open for taps.
            }
        }
    }
    const label = scroll.canScroll ? scroll.atTop ? '↓ ページ下部へ' : '↑ ページ上部へ' : 'ページ移動';
    const bridge = menu && anchor ? { left: Math.min(0, menu.x - anchor.x), top: Math.min(0, menu.y - anchor.y), width: Math.max(anchor.x + (frame?.size.width ?? 128), menu.x + menu.width) - Math.min(anchor.x, menu.x), height: Math.max(anchor.y + (frame?.size.height ?? 44), menu.y + menu.height) - Math.min(anchor.y, menu.y) } : undefined;
    return <div ref={root} className={`page-edge-navigation ${open ? 'is-open' : ''}`} role="navigation" aria-label="ページ移動"
        style={{ left: anchor?.x ?? 8, top: anchor?.y ?? 8, width: frame?.size.width ?? 128, visibility: frame ? 'visible' : 'hidden', zIndex: frame && anchor && (anchor.y < frame.bounds.headerBottom || (open && menu && menu.y < frame.bounds.headerBottom)) ? 60 : 40 }}
        onContextMenu={event => event.preventDefault()}
        onPointerEnter={event => { if (event.pointerType === 'mouse' && !gesture.current) changeOpen(true); }}
        onPointerLeave={event => { if (event.pointerType === 'mouse' && !gesture.current && !root.current?.contains(document.activeElement)) close(); }}
        onFocus={event => { if (!gesture.current && !physicalTap.current && !suppressClick.current && !event.currentTarget.contains(event.relatedTarget)) changeOpen(true); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
        <span className="edge-safe-area" aria-hidden="true" />
        <span id="edge-instructions" className="sr-only">短押しで上下移動、長押しでメニュー、長押し前に動かすと位置移動。キーボードはTabで項目選択、Escapeで閉鎖、Altと矢印キーで位置移動、HomeとEndで上下移動。読み上げのボタン操作でメニューを開けます。</span>
        {open && <span className="edge-bridge" aria-hidden="true" style={bridge} />}
        <button ref={button} type="button" className="edge-scroll" aria-expanded={open} aria-controls="edge-shortcuts" aria-describedby="edge-instructions"
            onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
            onKeyDown={event => {
                if (event.defaultPrevented) return;
                const delta: Record<string, Point> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } };
                if (event.altKey && frame && delta[event.key]) { event.preventDefault(); setFrame({ ...frame, position: clamp({ x: frame.position.x + delta[event.key].x, y: frame.position.y + delta[event.key].y }, frame.size, frame.bounds) }); }
                else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); suppressClick.current = false; if (openRef.current) close(); else changeOpen(true); }
                else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); changeOpen(true); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-edge-destination="${event.key === 'ArrowDown' ? 0 : availableDestinations.length - 1}"]`)?.focus()); }
                else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); moveToEdge(event.key === 'Home' ? 'top' : 'bottom'); }
            }}
            onClick={event => {
                const suppressed = suppressClick.current, tap = physicalTap.current;
                suppressClick.current = false; physicalTap.current = false;
                if (suppressed && (event.detail !== 0 || ('pointerType' in event.nativeEvent && event.nativeEvent.pointerType))) { event.preventDefault(); return; }
                // Scroll only after an actual short pointer sequence. Virtual / AT
                // activation opens the shortcuts even when click.detail is nonzero.
                if (tap && scroll.canScroll) moveToEdge();
                else { changeOpen(true); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-edge-destination="0"]')?.focus()); }

            }}>{label}</button>
        <div id="edge-shortcuts" className={`edge-shortcuts ${menu?.compact ? 'is-compact' : ''}`} role="group" aria-label={menu?.compact ? 'ショートカット一覧（スクロールできます）' : 'ショートカット一覧'} hidden={!open}
            style={menu && anchor ? { left: menu.x - anchor.x, top: menu.y - anchor.y, width: menu.width, height: menu.height } : undefined}>
            {availableDestinations.map(([id, text], index) => <button key={id} type="button" data-edge-destination={index} className={`edge-destination edge-destination-${index} ${selected === index ? 'is-selected' : ''}`} onClick={() => choose(index)}>{text}</button>)}
        </div>
    </div>;
}
