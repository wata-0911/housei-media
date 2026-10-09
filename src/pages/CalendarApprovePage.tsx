import { useEffect, useState } from 'react';
import liff from '@line/liff';

type AuthState =
    | { status: 'loading' }
    | { status: 'logged_out' }
    | { status: 'verifying'; displayName: string }
    | { status: 'authorized'; displayName: string }
    | { status: 'forbidden'; message: string }
    | { status: 'auth_error'; message: string }
    | { status: 'api_error'; message: string }
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
        const controller = new AbortController();

        async function initialize() {
            try {
                const liffId = import.meta.env.VITE_LIFF_ID;

                if (!liffId) {
                    throw new Error('LIFF configuration missing');
                }

                await initializeLiff(liffId);

                if (cancelled) return;

                if (!liff.isLoggedIn()) {
                    setAuth({ status: 'logged_out' });
                    return;
                }

                const displayName =
                    liff.getDecodedIDToken()?.name || 'LINEユーザー';

                // サーバーへ送るのは生のIDトークン
                const idToken = liff.getIDToken();

                if (!idToken) {
                    setAuth({
                        status: 'auth_error',
                        message:
                            'LINE IDトークンを取得できませんでした。再ログインしてください。',
                    });
                    return;
                }

                setAuth({
                    status: 'verifying',
                    displayName,
                });

                try {
                    const response = await fetch('/api/calendar-auth', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ idToken }),
                        cache: 'no-store',
                        credentials: 'same-origin',
                        signal: controller.signal,
                    });

                    if (cancelled) return;

                    if (response.status === 200) {
                        const data: unknown = await response
                            .json()
                            .catch(() => null);

                        if (cancelled) return;

                        if (
                            data !== null &&
                            typeof data === 'object' &&
                            'authorized' in data &&
                            data.authorized === true
                        ) {
                            setAuth({
                                status: 'authorized',
                                displayName,
                            });
                        } else {
                            setAuth({
                                status: 'api_error',
                                message:
                                    '認証APIから想定外の応答が返されました。',
                            });
                        }

                        return;
                    }

                    if (response.status === 403) {
                        setAuth({
                            status: 'forbidden',
                            message:
                                'このLINEグループのメンバーではない、または所属を確認できません。',
                        });
                        return;
                    }

                    if (response.status === 401) {
                        setAuth({
                            status: 'auth_error',
                            message:
                                'LINE認証情報が無効または期限切れです。再ログインしてください。',
                        });
                        return;
                    }

                    if (response.status === 400) {
                        setAuth({
                            status: 'auth_error',
                            message:
                                '認証リクエストが不正です。設定を確認してください。',
                        });
                        return;
                    }

                    setAuth({
                        status: 'api_error',
                        message:
                            `認証サーバーまたはLINE APIでエラーが発生しました（HTTP ${response.status}）。`,
                    });
                } catch {
                    if (cancelled || controller.signal.aborted) {
                        return;
                    }

                    setAuth({
                        status: 'api_error',
                        message:
                            '認証サーバーに接続できませんでした。通信環境を確認してください。',
                    });
                }
            } catch {
                if (cancelled) return;

                setAuth({
                    status: 'error',
                    message:
                        'LINEログインの初期化に失敗しました。',
                });
            }
        }

        void initialize();

        return () => {
            cancelled = true;
            controller.abort();
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


                        {auth.status === 'verifying' && (
                            <div className="mt-3" role="status">
                                <p className="font-semibold text-blue-700">
                                    LINEログイン成功
                                </p>
                                <p className="mt-1 text-sm">
                                    {auth.displayName} さん
                                </p>
                                <p className="mt-2 text-sm">
                                    承認グループへの所属を確認中...
                                </p>
                            </div>
                        )}

                        {auth.status === 'authorized' && (
                            <div className="mt-3" role="status">
                                <p className="font-semibold text-green-700">
                                    承認権限を確認しました
                                </p>
                                <p className="mt-1 text-sm">
                                    {auth.displayName} さん
                                </p>
                                <p className="mt-2 text-xs text-gray-500">
                                    LINEグループへの所属を確認済みです。
                                </p>
                            </div>
                        )}

                        {(
                            auth.status === 'forbidden' ||
                            auth.status === 'auth_error' ||
                            auth.status === 'api_error' ||
                            auth.status === 'error'
                        ) && (
                                <p
                                    role="alert"
                                    className="mt-2 text-sm text-red-600"
                                >
                                    {auth.message}
                                </p>
                            )}
                    </div>

                    <h2 className="mb-2 text-xl font-semibold">
                        確認対象カレンダー
                    </h2>


                    <p className="mb-4 text-sm text-amber-700">
                        現在は認証確認フェーズです。
                    </p>
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

