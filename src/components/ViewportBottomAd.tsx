import { useEffect, useRef, useState } from 'react';

function configuredBanner() {
  const image = import.meta.env.VITE_SITE_AD_IMAGE;
  const description = import.meta.env.VITE_SITE_AD_ALT?.trim();
  if (typeof image !== 'string' || !/^\/ads-[A-Za-z0-9_-]+\.(?:avif|gif|jpe?g|png|webp)$/.test(image) || !description) return null;
  try {
    const destination = new URL(import.meta.env.VITE_SITE_AD_URL);
    if (destination.protocol !== 'https:' || destination.username || destination.password) return null;
    return { image, description, href: destination.href };
  } catch {
    return null;
  }
}

const banner = configuredBanner();
export const hasViewportBottomAd = banner !== null;

export default function ViewportBottomAd({ onInsetChange }: { onInsetChange: (height: number) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [obstructed, setObstructed] = useState(false);
  const band = useRef<HTMLElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const match = window.matchMedia('(pointer: coarse)');
    const refresh = () => setObstructed(viewport.scale > 1.05
      || (match.matches && document.documentElement.clientHeight - viewport.height > 120));
    refresh();
    viewport.addEventListener('resize', refresh);
    window.addEventListener('resize', refresh);
    return () => {
      viewport.removeEventListener('resize', refresh);
      window.removeEventListener('resize', refresh);
    };
  }, []);
  const visible = loaded && !failed && !obstructed;
  useEffect(() => {
    const element = band.current;
    if (!visible || !element) {
      onInsetChange(0);
      return;
    }
    const update = () => onInsetChange(Math.ceil(element.getBoundingClientRect().height));
    const observer = new ResizeObserver(update);
    update();
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, onInsetChange]);

  if (!banner || failed) return null;
  return <aside ref={band} aria-label="広告" hidden={!visible}
    className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white px-2 pt-1 text-center text-xs text-gray-700"
    style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }}>
    <div>広告</div>
    <a href={banner.href} target="_blank" rel="sponsored noopener noreferrer"
      className="inline-block max-w-full align-top focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
      <img src={banner.image} alt={banner.description}
        className="block h-auto max-h-[min(84px,16dvh)] max-w-full object-contain"
        onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </a>
  </aside>;
}
