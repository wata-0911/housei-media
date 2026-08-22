export default async function handler(req, res) {
  try {
    // ステップ1で取得したRSS.appのフィードURLに置き換えてください
    const rssUrl = 'https://rss.app/feeds/DjTTnJM54Xd7QeFI.xml';

    const response = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    if (!response.ok) {
      throw new Error('RSSの取得に失敗しました');
    }

    const xmlText = await response.text();

    // XML内から status/数字（ポストID）を正規表現で抽出
    const matches = xmlText.match(/status\/(\d+)/g);

    if (!matches) {
      // 抽出できない場合のフォールバックID
      return res.status(200).json({
        tweetIds: ['2084907256160637081', '2084929908820852873']
      });
    }

    // 重複を排除し、最新の2件を配列にする
    const uniqueIds = Array.from(
      new Set(matches.map((item) => item.replace('status/', '')))
    );
    const latestTwoIds = uniqueIds.slice(0, 2);

    // 5分（300秒）キャッシュ設定：Xの制限を回避しつつ投稿を素早く反映
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ tweetIds: latestTwoIds });
  } catch (error) {
    console.error('Error fetching tweets:', error);
    // 通信エラー時もサイトが落ちないように固定IDを返却
    return res.status(200).json({
      tweetIds: ['2084907256160637081', '2084929908820852873']
    });
  }
}