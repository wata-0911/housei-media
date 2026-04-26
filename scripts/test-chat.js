import { GoogleGenerativeAI } from "@google/generative-ai";
require('dotenv').config();
const apiKey = process.env.GCP_API_KE;
// v1betaを明示して初期化します
const genAI = new GoogleGenerativeAI(apiKey);

async function testChat() {
    try {
        // 診断結果と完全に一致するモデル名「gemini-3-pro-preview」を指定します
        const model = genAI.getGenerativeModel(
            {
                model: "gemini-3-pro-preview",
                cachedContent: "cachedContents/6meztqjp9xij70t39647rd3xocqkewn3kwnz5iiz",
            },
            { apiVersion: "v1beta" }
        );

        console.log("AIの13万トークンの記憶に直接アクセス中...");

        const prompt = `
指示：あなたは今、法政大学の資料（shiori2026.pdf）のデータを脳内に直接ロードした状態で動いています。
「資料がない」という回答は、システム上の矛盾（バグ）となります。
自分のメモリにある138,910トークンの情報を検索し、以下の質問に答えてください。

質問：1年間に履修登録できる単位数（スクーリング含む）の上限は？
`;

        const result = await model.generateContent(prompt);

        console.log("【AIの回答】");
        console.log(result.response.text());

    } catch (error) {
        console.error("エラーが発生しました:", error);
    }
}

testChat();