import { GoogleAICacheManager } from "@google/generative-ai/server";
require('dotenv').config();
const apiKey = process.env.GCP_API_KE;
const cacheManager = new GoogleAICacheManager(apiKey);

async function checkCacheStatus() {
  try {
    // ここに、現在使おうとしているキャッシュ名を貼り付けてください
    const cacheName = "cachedContents/6meztqjp9xij70t39647rd3xocqkewn3kwnz5iiz";
    console.log(`キャッシュの状態を確認中: ${cacheName}`);
    const cacheInfo = await cacheManager.get(cacheName);
    console.log("--- 診断結果 ---");
    console.log(`モデル名: ${cacheInfo.model}`);
    console.log(`有効期限: ${cacheInfo.expireTime}`);
    console.log(`作成時間: ${cacheInfo.createTime}`);
    
    // ここが重要：中身（トークン数）が入っているか
    console.log(`記憶されたデータの量: ${cacheInfo.usageMetadata.totalTokenCount} トークン`);
    
    if (cacheInfo.usageMetadata.totalTokenCount > 0) {
      console.log("論理的結論：AIの記憶の中にデータは存在します。問題は『呼び出し方』にあります。");
    } else {
      console.log("論理的結論：キャッシュは存在しますが、中身が空です。作成をやり直す必要があります。");
    }
    
  } catch (error) {
    console.error("診断エラー：指定されたキャッシュが見つかりません。すでに削除されているか、名前が間違っています。");
  }
}

checkCacheStatus();