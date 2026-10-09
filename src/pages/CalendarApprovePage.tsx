import { useEffect, useState } from 'react';
import liff from '@line/liff';

type AuthState =
    | { status: 'loading' }
    | { status: 'logged_out' }
    | { status: 'logged_in'; displayName: string }
    | { status: 'error'; message: string };

let initPromise: Promise<void> | null = null;

function initializeLiff(liffId: string) {
    if (!initPromise) {
        initPromise = liff.init({ liffId }).catch((error) => {
            initPromise = null;
            throw error;
        });
    }
    return initPromise;
}

export default function CalendarApprovePage() {
    const [auth, setAuth] = useState<AuthState>({
        status: 'loading',
    });

    useEffect(() => {
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = 'noindex, nofollow';
        document.head.appendChild(meta);

        return () => meta.remove();
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function initialize() {
            try {
                const liffId = import.meta.env.VITE_LIFF_ID;

                if (!liffId) {
                    throw new Error('VITE_LIFF_ID が設定されていません');
                }

                await initializeLiff(liffId);

                if (cancelled) return;

                if (!liff.isLoggedIn()) {
                    setAuth({ status: 'logged_out' });
                    return;
                }

                const token = liff.getDecodedIDToken();

                setAuth({
                    status: 'logged_in',
                    displayName: token?.name || 'LINEユーザー',
                });
            } catch (error) {
                if (cancelled) return;

                setAuth({
                    status: 'error',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'LIFFの初期化に失敗しました',
                });
            }
        }

        void initialize();

        return () => {
            cancelled = true;
        };
    }, []);

    function handleLogin() {
        if (!liff.isInClient() && !liff.isLoggedIn()) {
            liff.login();
        }
    }

    return (
        <section className="min-h-screen bg-[#F5F5F7] px-4 py-20">
            <div className="mx-auto max-w-3xl">
                <h1 className="mb-3 text-center text-3xl font-bold text-[#002255]">
                    カレンダー承認
                </h1>

                <p className="mb-8 text-center text-sm text-gray-500">
                    法政通信メディア 運営メンバー専用
                </p>

                <div className="rounded-xl border bg-white p-6 shadow-sm">
                    <div className="mb-6 rounded-lg bg-gray-100 p-4">
                        <h2 className="font-semibold">LINE認証</h2>

                        {auth.status === 'loading' && (
                            <p className="mt-2 text-sm">認証状態を確認中...</p>
                        )}

                        {auth.status === 'logged_out' && (
                            <div className="mt-3">
                                <p className="mb-3 text-sm">
                                    LINEログインが必要です。
                                </p>
                                <button
                                    type="button"
                                    onClick={handleLogin}
                                    className="rounded-lg bg-[#06C755] px-5 py-3 font-semibold text-white"
                                >
                                    LINEでログイン
                                </button>
                            </div>
                        )}

                        {auth.status === 'logged_in' && (
                            <div className="mt-3">
                                <p className="font-semibold text-green-700">
                                    LINEログイン成功
                                </p>
                                <p className="mt-1 text-sm">
                                    {auth.displayName} さん
                                </p>
                                <p className="mt-2 text-xs text-gray-500">
                                    ※ グループ所属確認は未実装です。
                                </p>
                            </div>
                        )}

                        {auth.status === 'error' && (
                            <p role="alert" className="mt-2 text-sm text-red-600">
                                {auth.message}
                            </p>
                        )}
                    </div>

                    <h2 className="mb-2 text-xl font-semibold">
                        確認対象カレンダー
                    </h2>

                    <p className="mb-4 text-sm text-gray-500">
                        対象月：未取得
                    </p>

                    <div className="mb-6 flex aspect-video items-center justify-center rounded-lg border border-dashed bg-gray-50">
                        <p className="text-sm text-gray-500">
                            権限確認後にカレンダー画像を表示します
                        </p>
                    </div>

                    <p className="mb-4 text-sm text-amber-700">
                        グループ所属確認が完了するまで承認できません。
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            type="button"
                            disabled
                            className="cursor-not-allowed rounded-lg border px-4 py-3 text-gray-400"
                        >
                            修正が必要
                        </button>

                        <button
                            type="button"
                            disabled
                            className="cursor-not-allowed rounded-lg bg-gray-300 px-4 py-3 font-semibold text-white"
                        >
                            この画像を承認
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}