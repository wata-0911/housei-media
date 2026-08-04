import React, { useEffect, useRef } from 'react';

export default function XTimeline({ tweetId = '2084129602176503976' }) {
  const containerRef = useRef(null);

  useEffect(() => {
    // tweetIdの余計な空白や改行を自動除去
    const cleanTweetId = String(tweetId).trim();
    if (!cleanTweetId) return;

    const renderTweet = () => {
      if (window.twttr && window.twttr.widgets && containerRef.current) {
        containerRef.current.innerHTML = '';
        window.twttr.widgets.createTweet(
          cleanTweetId,
          containerRef.current,
          {
            theme: 'light',
            align: 'center',
            conversation: 'none'
          }
        );
      }
    };

    const scriptId = 'twitter-wjs';
    let script = document.getElementById(scriptId);

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://platform.twitter.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      document.head.appendChild(script);
    }

    // window.twttr が準備完了するまで安全に待機して描画
    if (window.twttr && window.twttr.widgets) {
      renderTweet();
    } else {
      const interval = setInterval(() => {
        if (window.twttr && window.twttr.widgets) {
          renderTweet();
          clearInterval(interval);
        }
      }, 100);

      return () => clearInterval(interval);
    }
  }, [tweetId]);

  return (
    <div className="w-full flex justify-center items-center min-h-[300px]">
      <div ref={containerRef} className="w-full max-w-lg" />
    </div>
  );
}