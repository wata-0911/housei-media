import React, { useEffect, useRef } from 'react';

export default function XTimeline({ username }) {
  const containerRef = useRef(null);
  const isMounted = useRef(false);

  useEffect(() => {
    if (isMounted.current) return;
    isMounted.current = true;

    const scriptId = 'twitter-wjs';
    let script = document.getElementById(scriptId);

    const renderWidget = () => {
      if (window.twttr && window.twttr.widgets && containerRef.current) {
        window.twttr.widgets.load(containerRef.current);
      }
    };

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://platform.twitter.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      script.onload = renderWidget;
      document.head.appendChild(script);
    } else {
      renderWidget();
    }
  }, [username]);

  return (
    <div 
      ref={containerRef} 
      className="w-full flex justify-center items-center"
      style={{ minHeight: '600px' }}
    >
      <a
        className="twitter-timeline"
        data-height="600"
        data-theme="light"
        data-chrome="noheader nofooter"
        href={`https://x.com/${username}`}
      >
        Xの投稿を読み込んでいます...
      </a>
    </div>
  );
}