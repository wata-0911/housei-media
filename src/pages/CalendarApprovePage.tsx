import { useEffect, useRef, useState } from 'react';
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

type DraftIdentity = { draftId: string; revision: string; imageSha256: string; previewReceipt: string; status: 'draft_ready' | 'approved' };
type ApprovalState = { status: 'idle' | 'submitting' | 'done' | 'error'; message?: string; retryable?: boolean };

type DraftState =
    | { status: 'idle' | 'loading' }
    | { status: 'ready'; url: string; yearMonth: string; generatedAt: string; identity: DraftIdentity | null; displayed: boolean }
    | { status: 'error'; message: string };

const authErrorMessages: Record<string, string> = {
    auth_server_config: '認証サーバーの設定が不足しています。',
    auth_invalid_request: '認証リクエストが不正です。再ログインしてください。',
    line_token_invalid: 'LINE認証情報が無効または期限切れです。再ログインしてください。',
    line_nonmember: '承認用グループへの所属を確認できません。',
    line_verification_unavailable: 'LINE認証サービスを確認できませんでした。時間をおいて再度お試しください。',
    line_membership_unavailable: 'LINEグループへの所属を確認できませんでした。時間をおいて再度お試しください。',
};

function authErrorMessage(code: unknown): string | undefined {
    return typeof code === 'string' && Object.hasOwn(authErrorMessages, code) ? authErrorMessages[code] : undefined;
}

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

    const previewUrlRef = useRef<string | null>(null);
    const [draft, setDraft] = useState<DraftState>({ status: 'idle' });

    const [refresh, setRefresh] = useState(0);
    const [approval, setApproval] = useState<ApprovalState>({ status: 'idle' });
    const approvalLock = useRef(false);
    const approvalController = useRef<AbortController | null>(null);

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
        let previewUrl: string | null = null;

        async function loadDraft(idToken: string) {
            setDraft({ status: 'loading' });
            try {
                const response = await fetch('/api/calendar-draft', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken }),
                    cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
                });
                if (cancelled) return;
                if (!response.ok) {
                    const messages: Record<number, string> = {
                        400: '認証リクエストが不正です。再ログインしてください。',
                        401: 'LINE認証情報が無効または期限切れです。再ログインしてください。',
                        403: '承認用グループへの所属を確認できません。',
                        404: '表示できる下書きはまだありません。',
                        503: '下書き取得サーバーの設定が不足しています。',
                        504: '下書き取得がタイムアウトしました。',
                    };
                    const data: unknown = await response.json().catch(() => null);
                    if (cancelled) return;
                    const code = data && typeof data === 'object' && 'code' in data ? data.code : null;
                    const message = authErrorMessage(code) || (code === 'draft_bridge_auth'
                        ? '下書き取得先の認証設定を確認してください。'
                        : code === 'draft_invalid_response'
                            ? '有効なカレンダー画像と日時情報を取得できませんでした。'
                            : code === 'draft_upstream'
                                ? '下書き取得先でエラーが発生しました。'
                                : messages[response.status] || '下書き取得サーバーまたはLINE APIでエラーが発生しました。');
                    setDraft({ status: 'error', message });
                    return;
                }
                const yearMonth = response.headers.get('X-Calendar-Year-Month');
                const generatedAt = response.headers.get('X-Calendar-Generated-At');
                if (response.headers.get('Content-Type') !== 'image/png' ||
                    !yearMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth) ||
                    generatedAt === null || (generatedAt !== '' &&
                        (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))))) {
                    throw new Error('Invalid preview response');
                }
                const blob = await response.blob();
                if (cancelled) return;
                if (!blob.size || blob.size > 2_621_440) throw new Error('Invalid preview size');
                const draftId = response.headers.get('X-Calendar-Draft-Id');
                const revision = response.headers.get('X-Calendar-Revision');
                const imageSha256 = response.headers.get('X-Calendar-Image-Sha256');
                const status = response.headers.get('X-Calendar-Status');
                const previewReceipt = response.headers.get('X-Calendar-Preview-Receipt');
                const identity: DraftIdentity | null = draftId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftId) &&
                    revision && /^[1-9][0-9]*$/.test(revision) && imageSha256 && /^[0-9a-f]{64}$/.test(imageSha256) &&
                    (status === 'draft_ready' || status === 'approved') && previewReceipt
                    ? { draftId, revision, imageSha256, status, previewReceipt } : null;
                if (identity) {
                    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
                    if (cancelled) return;
                    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
                    if (hash !== identity.imageSha256) throw new Error('Preview identity mismatch');
                }
                previewUrl = URL.createObjectURL(blob);
                previewUrlRef.current = previewUrl;
                setDraft({ status: 'ready', url: previewUrl, yearMonth, generatedAt, identity, displayed: false });
            } catch {
                if (cancelled || controller.signal.aborted) return;
                setDraft({ status: 'error', message: 'カレンダー画像を取得できませんでした。通信環境を確認してください。' });
            }
        }

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
                            await loadDraft(idToken);
                        } else {
                            setAuth({
                                status: 'api_error',
                                message:
                                    '認証APIから想定外の応答が返されました。',
                            });
                        }

                        return;
                    }

                    const errorData: unknown = await response.json().catch(() => null);
                    if (cancelled) return;
                    const errorCode = errorData && typeof errorData === 'object' && 'code' in errorData ? errorData.code : null;
                    const errorMessage = authErrorMessage(errorCode);

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
                                errorMessage || 'LINE認証情報が無効または期限切れです。再ログインしてください。',
                        });
                        return;
                    }

                    if (response.status === 400) {
                        setAuth({
                            status: 'auth_error',
                            message:
                                errorMessage || '認証リクエストが不正です。設定を確認してください。',
                        });
                        return;
                    }

                    setAuth({
                        status: 'api_error',
                        message:
                            errorMessage || (response.status === 503
                                ? '認証サーバーの設定が不足しています。'
                                : `認証サーバーまたはLINE APIでエラーが発生しました（HTTP ${response.status}）。`),
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
            approvalController.current?.abort();
            if (previewUrl && previewUrlRef.current === previewUrl) {
                URL.revokeObjectURL(previewUrl);
                previewUrlRef.current = null;
            }
        };
    }, [refresh]);


    function handleLogin() {
        if (!liff.isInClient() && !liff.isLoggedIn()) {
            liff.login();
        }
    }

    function handleRefresh() {
        if (approvalController.current || approval.status === 'submitting') return;
        approvalLock.current = false;
        setApproval({ status: 'idle' });
        setDraft({ status: 'loading' });
        setAuth({ status: 'loading' });
        setRefresh(value => value + 1);
    }

    async function handleApprove() {
        if (approvalLock.current || auth.status !== 'authorized' || draft.status !== 'ready' ||
            !draft.displayed || !draft.identity || draft.identity.status !== 'draft_ready' || previewUrlRef.current !== draft.url) return;
        // State updates are asynchronous: the ref also blocks same-tick repeated clicks.
        approvalLock.current = true;
        const target = draft.identity;
        const previewUrl = draft.url;
        const controller = new AbortController();
        approvalController.current = controller;
        const timer = window.setTimeout(() => controller.abort(), 20_000);
        setApproval({ status: 'submitting' });
        try {
            const idToken = liff.isLoggedIn() ? liff.getIDToken() : null;
            if (!idToken) {
                setApproval({ status: 'error', message: 'LINE認証情報を取得できません。再ログインして下書きを再取得してください。' });
                return;
            }
            const response = await fetch('/api/calendar-approve', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken, draftId: target.draftId, revision: target.revision,
                    imageSha256: target.imageSha256, previewReceipt: target.previewReceipt }),
                cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
            });
            const data = await response.json().catch(() => null);
            if (previewUrlRef.current !== previewUrl) return;
            if (controller.signal.aborted) throw new Error('Approval result unknown');
            if (response.ok && data?.ok === true && data.status === 'approved' &&
                data.draftId === target.draftId && data.revision === target.revision && data.imageSha256 === target.imageSha256 &&
                typeof data.approvedAt === 'string' && Number.isFinite(Date.parse(data.approvedAt)) &&
                ['APPROVED', 'ALREADY_APPROVED', 'ALREADY_APPROVED_BY_OTHER'].includes(data.code)) {
                const message = data.code === 'APPROVED' ? 'この画像の承認を記録しました。' :
                    data.code === 'ALREADY_APPROVED_BY_OTHER' ? '別のメンバーがすでにこの画像を承認しています。' : 'この画像はすでに承認済みです。';
                setApproval({ status: 'done', message: `${message} 承認日時：${data.approvedAt}。配信は行いません。` });
                return;
            }
            const messages: Record<number, string> = {
                409: '下書きが更新されたか、承認対象が一致しません。下書きを再取得して画像を確認してください。',
                401: '認証情報または画像の確認期限が切れています。再ログインして下書きを再取得してください。',
                403: '承認用グループへの所属を確認できません。承認できません。',
                503: '承認機能を利用できません。設定を確認後、下書きを再取得してください。',
            };
            setApproval({ status: 'error', retryable: [502, 504].includes(response.status), message: messages[response.status] || '承認結果を確認できませんでした。承認済みの可能性があります。下書きを再取得して状態を確認してください。' });
        } catch {
            if (previewUrlRef.current === previewUrl) {
                setApproval({ status: 'error', retryable: true, message: '承認結果を確認できませんでした。承認済みの可能性があります。下書きを再取得して状態を確認してください。' });
            }
        } finally {
            window.clearTimeout(timer);
            if (approvalController.current === controller) approvalController.current = null;
        }
    }

    const canApprove = auth.status === 'authorized' && draft.status === 'ready' && draft.displayed &&
        draft.identity?.status === 'draft_ready' && approval.status === 'idle';

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
                        最初の1名の承認を記録します。修正依頼・公開・LINE配信は行いません。
                    </p>
                    <p className="mb-2 text-sm text-gray-500">
                        対象月：{draft.status === 'ready' ? draft.yearMonth : '未取得'}
                    </p>
                    {draft.status === 'ready' && (
                        <p className="mb-4 text-sm text-gray-500">
                            生成日時：{draft.generatedAt
                                ? <time dateTime={draft.generatedAt}>{draft.generatedAt}</time>
                                : '不明'}
                        </p>
                    )}
                    <div className="mb-6 rounded-lg border bg-gray-50 p-2" aria-busy={draft.status === 'loading'}>
                        {draft.status === 'ready' ? (
                            <img src={draft.url} alt={`${draft.yearMonth} カレンダー下書き`} className="h-auto w-full rounded" onLoad={() => {
                                if (previewUrlRef.current !== draft.url) return;
                                setDraft(current => current.status === 'ready' && current.url === draft.url
                                    ? { ...current, displayed: true } : current);
                            }} onError={() => {
                                if (previewUrlRef.current !== draft.url) return;
                                if (approvalController.current) {
                                    approvalController.current.abort();
                                    setApproval({ status: 'error', message: '画像表示と承認結果を確認できません。下書きを再取得して状態を確認してください。' });
                                }
                                URL.revokeObjectURL(draft.url);
                                previewUrlRef.current = null;
                                setDraft({ status: 'error', message: 'カレンダー画像を表示できませんでした。' });
                            }} />
                        ) : (
                            <p className="py-12 text-center text-sm text-gray-500" role={draft.status === 'error' ? 'alert' : 'status'}>
                                {draft.status === 'loading' ? 'カレンダー画像を取得中...' :
                                    draft.status === 'error' ? draft.message : '権限確認後にカレンダー画像を表示します'}
                            </p>
                        )}
                    </div>

                    {draft.status === 'ready' && !draft.identity && (
                        <p className="mb-4 text-sm text-amber-700" role="status">この下書きは確認専用です。承認に必要な画像情報がありません。</p>
                    )}
                    {draft.status === 'ready' && draft.identity?.status === 'approved' && (
                        <p className="mb-4 text-sm text-green-700" role="status">この画像はすでに承認済みです。配信は行いません。</p>
                    )}
                    {approval.status !== 'idle' && (
                        <p className="mb-4 text-sm" role={approval.status === 'error' ? 'alert' : 'status'}>
                            {approval.status === 'submitting' ? '承認結果を確認中...' : approval.message}
                        </p>
                    )}
                    {approval.status === 'error' && approval.retryable && (
                        <button type="button" onClick={() => { if (approvalController.current) return; approvalLock.current = false; void handleApprove(); }}
                            className="mb-4 mr-3 rounded-lg border px-4 py-2">
                            同じ画像の承認を再送信
                        </button>
                    )}
                    {auth.status === 'authorized' && (
                        <button type="button" onClick={handleRefresh} disabled={approval.status === 'submitting'}
                            className="mb-4 rounded-lg border px-4 py-2 disabled:cursor-not-allowed disabled:text-gray-400">
                            下書きを再取得
                        </button>
                    )}
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
                            disabled={!canApprove}
                            onClick={() => void handleApprove()}
                            className="rounded-lg bg-[#002255] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                        >
                            この画像を承認
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}