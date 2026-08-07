export default async function handler(req, res) {
  try {
    // RSSHub等の公開フィードURLからアカウントのRSSを取得
    const rssUrl = 'https://rsshub.app/twitter/user/hosei_c_media';
    const response = await fetch(rssUrl);

    if (!response.ok) {
      throw new Error('RSSの取得に失敗しました');
    }

    const xmlText = await response.text();

    // RSSテキスト内からポストID（status/数字）を正規表現で抽出
    const matches = xmlText.match(/status\/(\d+)/g);

    if (!matches) {
      // 取得できない場合はデフォルトのIDを返す
      return res.status(200).json({ 
        tweetIds: ['2084129602176503976', '2082412435609457121'] 
      });
    }

    // 重複を除外して最新の2件を抽出
    const uniqueIds = Array.from(
      new Set(matches.map((item) => item.replace('status/', '')))
    );
    const latestTwoIds = uniqueIds.slice(0, 2);

    // 1時間（3600秒）キャッシュを有効化してX側の制限とアクセス遅延を防止
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
    return res.status(200).json({ tweetIds: latestTwoIds });
  } catch (error) {
    console.error('RSS Fetch Error:', error);
    // エラー発生時のフォールバック用ID
    return res.status(200).json({ 
      tweetIds: ['2084129602176503976', '2082412435609457121'] 
    });
  }
}