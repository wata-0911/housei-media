import { GoogleAIFileManager, GoogleAICacheManager } from "@google/generative-ai/server";
require('dotenv').config();
const apiKey = process.env.GCP_API_KE;
const fileManager = new GoogleAIFileManager(apiKey);
const cacheManager = new GoogleAICacheManager(apiKey);

async function setupMaterial() {
    try {
        console.log("PDFをアップロード中...");
        const uploadResult = await fileManager.uploadFile("./documents/shiori2026.pdf", {
            mimeType: "application/pdf",
            displayName: "shiori2026.pdf",
        });

        let fileState = await fileManager.getFile(uploadResult.file.name);
        console.log("GoogleのサーバーでPDFを解析中...");

        while (fileState.state === "PROCESSING") {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 5000));
            fileState = await fileManager.getFile(uploadResult.file.name);
        }

        if (fileState.state === "FAILED") {
            throw new Error("PDFの解析に失敗しました。");
        }

        console.log("\n解析完了！");
        const fileUri = fileState.uri;

        console.log("キャッシュを作成中...");
        const cache = await cacheManager.create({
            model: "models/gemini-3-pro-preview",
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            fileData: {
                                fileUri: fileUri,
                                mimeType: "application/pdf",
                            },
                        },
                    ],
                },
            ],
            // ここを修正：全文出力禁止の制約を削除し、純粋に論理的な回答を求めます
            systemInstruction: "あなたは法政大学の資料に基づく専門ガイドです。提供された資料データに基づき、厳密かつ論理的に答えてください。",
            ttlSeconds: 3600,
        });

        console.log("キャッシュ作成成功！");
        console.log("キャッシュ名（これを保存してください）:", cache.name);

        return cache.name;
    } catch (error) {
        console.error("エラーが発生しました:", error);
    }
}

setupMaterial();