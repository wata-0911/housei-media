import React, { useEffect, useRef } from 'react';

export default function XTimeline({ tweetId = '2084129602176503976' }) {
  const containerRef = useRef(null);
  const isMounted = useRef(false);

  useEffect(() => {
    if (isMounted.current) return;
    isMounted.current = true;

    const scriptId = 'twitter-wjs';
    let script = document.getElementById(scriptId);

    const renderTweet = () => {
      if (window.twttr && window.twttr.widgets && containerRef.current) {
        // 重複描画を防ぐためコンテナを初期化
        containerRef.current.innerHTML = '';
        
        // 特定ポストの埋め込みを実行
        window.twttr.widgets.createTweet(
          tweetId,
          containerRef.current,
          {
            theme: 'light',
            align: 'center',
            conversation: 'none' // 返信スレッドを非表示にしてスッキリ見せる設定
          }
        );
      }
    };

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://platform.twitter.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      script.onload = renderTweet;
      document.head.appendChild(script);
    } else {
      renderTweet();
    }
  }, [tweetId]);

  return (
    <div className="w-full flex justify-center items-center min-h-[300px]">
      <div ref={containerRef} className="w-full max-w-lg" />
    </div>
  );
}