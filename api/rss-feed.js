export default async function handler(req, res) {
    try {
        // 実際に動作しているRSS.appのURL
        const rssUrl = 'https://rss.app/feeds/DjTTnJM54Xd7QeFl.xml';

        const response = await fetch(rssUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Fetch error: ${response.status}`);
        }

        const xmlText = await response.text();

        // 1分間キャッシュしてアクセス制限を防止
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
        return res.status(200).send(xmlText);
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}