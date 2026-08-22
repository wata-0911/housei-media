import React, { useEffect, useRef } from 'react';

export default function XTimeline({ tweetId }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const cleanTweetId = String(tweetId || '').trim();
    if (!cleanTweetId || !containerRef.current) return;

    let isMounted = true;
    const container = containerRef.current;
    container.innerHTML = '';

    const renderTweet = () => {
      if (!isMounted || !window.twttr || !window.twttr.widgets) return;

      container.innerHTML = '';
      window.twttr.widgets
        .createTweet(cleanTweetId, container, {
          theme: 'light',
          align: 'center',
          conversation: 'none'
        })
        .then((element) => {
          // 非同期完了時にアンマウント済み、または重複要素がある場合は破棄
          if (!isMounted && element) {
            element.remove();
          }
        });
    };

    const scriptId = 'twitter-wjs';
    let script = document.getElementById(scriptId);

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://platform.twitter.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      script.onload = () => {
        if (isMounted) renderTweet();
      };
      document.head.appendChild(script);
    } else {
      if (window.twttr && window.twttr.widgets) {
        renderTweet();
      } else {
        const onLoad = () => {
          if (isMounted) renderTweet();
        };
        script.addEventListener('load', onLoad, { once: true });
      }
    }

    return () => {
      isMounted = false;
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [tweetId]);

  return (
    <div className="w-full flex justify-center items-center min-h-[300px]">
      <div ref={containerRef} className="w-full max-w-lg" />
    </div>
  );
}