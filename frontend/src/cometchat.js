import { CometChatUIKit, UIKitSettingsBuilder } from '@cometchat/chat-uikit-react';
import { api } from './api';

let inited = false;
let loginPromise = null;

async function initCometChat(appId, region) {
  if (inited) return;
  const settings = new UIKitSettingsBuilder()
    .setAppId(appId)
    .setRegion(region)
    .subscribePresenceForAllUsers()
    .build();
  await CometChatUIKit.init(settings);
  inited = true;
}

/** Idempotent: provisions + logs the current portal user into CometChat. */
export function loginCometChat() {
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const { uid, authToken, appId, region } = await api.getCometAuthToken();
    await initCometChat(appId, region);
    // v7: getLoggedInUser() (capital "In") is synchronous, returns User | null.
    const current = CometChatUIKit.getLoggedInUser();
    if (!current || current.getUid() !== uid) {
      await CometChatUIKit.logout().catch(() => {});
      await CometChatUIKit.loginWithAuthToken(authToken);
    }
    return uid;
  })();
  // Don't cache a FAILED login — a CP enabled mid-session (or a transient
  // error) must be able to retry without a page reload.
  loginPromise.catch(() => { loginPromise = null; });
  return loginPromise;
}

export async function logoutCometChat() {
  loginPromise = null;
  try { await CometChatUIKit.logout(); } catch { /* ignore */ }
}
