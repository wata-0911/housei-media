
type Json = Record<string, unknown>;

function reply(data: Json, status: number): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function verifyCalendarRequest(request: Request): Promise<Response | { userId: string; displayName: string }> {
    if (request.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        {
          status: 405,
          headers: {
            Allow: 'POST',
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    const loginChannelId = process.env.LINE_LOGIN_CHANNEL_ID;
    const botToken = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
    const groupId = process.env.LINE_APPROVAL_GROUP_ID;

    if (!loginChannelId || !botToken || !groupId) {
      return reply({ code: 'auth_server_config', error: '認証サーバーの設定が不足しています' }, 503);
    }

    const body: unknown = await request.json().catch(() => null);
    const idToken =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Json).idToken
        : undefined;

    if (
      typeof idToken !== 'string' ||
      idToken.length === 0 ||
      idToken.length > 8192
    ) {
      return reply({ code: 'auth_invalid_request', error: 'IDトークンが不正です' }, 400);
    }

    let stage: 'verification' | 'membership' = 'verification';
    try {
      // 1. LINE LoginでIDトークンを検証
      const verifyResponse = await fetch(
        'https://api.line.me/oauth2/v2.1/verify',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            id_token: idToken,
            client_id: loginChannelId,
          }),
          signal: AbortSignal.timeout(10000),
          cache: 'no-store', redirect: 'error',
        },
      );

      if (!verifyResponse.ok) {
        const status =
          verifyResponse.status === 400 ||
            verifyResponse.status === 401
            ? 401
            : 502;

        return reply(
          { authorized: false, code: status === 401 ? 'line_token_invalid' : 'line_verification_unavailable', error: 'LINE認証の検証に失敗しました' },
          status,
        );
      }

      const verified: Json = await verifyResponse.json();

      if (
        verified.iss !== 'https://access.line.me' ||
        verified.aud !== loginChannelId ||
        typeof verified.exp !== 'number' || !Number.isFinite(verified.exp) ||
        verified.exp <= Date.now() / 1000 ||
        typeof verified.sub !== 'string' ||
        !/^U[0-9a-f]{32}$/.test(verified.sub)
      ) {
        return reply(
          { authorized: false, code: 'line_token_invalid', error: '認証情報が不正です' },
          401,
        );
      }

      const userId = verified.sub;

      // 2. LINE Botが参加する承認用グループの所属確認
      stage = 'membership';
      const memberResponse = await fetch(
        `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
        {
          headers: {
            Authorization: `Bearer ${botToken}`,
          },
          signal: AbortSignal.timeout(10000),
          cache: 'no-store', redirect: 'error',
        },
      );

      if (memberResponse.status === 404) {
        return reply(
          { authorized: false, code: 'line_nonmember', error: '承認用グループへの所属を確認できません' },
          403,
        );
      }


      if (!memberResponse.ok) {
        console.error('calendar-auth: LINE group member API failed', {
          upstreamStatus: memberResponse.status,
        });

        return reply(
          {
            authorized: false,
            code: 'line_membership_unavailable',
            error: 'グループ所属を確認できませんでした',
          },
          502,
        );
      }


      const member: Json = await memberResponse.json();

      if (member.userId !== userId) {
        return reply(
          { authorized: false, code: 'line_membership_unavailable', error: '所属確認の応答が不正です' },
          502,
        );
      }

      return { userId, displayName: typeof verified.name === 'string' ? verified.name : 'LINEユーザー' };
    } catch {
      return reply(
        { authorized: false, code: stage === 'membership' ? 'line_membership_unavailable' : 'line_verification_unavailable', error: 'LINE APIとの通信に失敗しました' },
        502,
      );
    }
}

// Public authentication response never exposes the verified actor identifier.
export async function authorizeCalendarRequest(request: Request): Promise<Response> {
  const result = await verifyCalendarRequest(request);
  return result instanceof Response ? result : reply({ authorized: true, displayName: result.displayName }, 200);
}
