# CometChat — disabled 2026-10-08

The in-app chat feature was retired. These files are the **frontend** half.
Nothing in `src/` imports them, so they are not in the Vite build graph and
never ship. They were moved, not deleted, so `git log --follow` still works.

## Files here

| File | Was at |
|---|---|
| `cometchat.js` | `src/cometchat.js` |
| `Chat.jsx` | `src/pages/Chat.jsx` |
| `Messages.jsx` | `src/cp/Messages.jsx` |
| `CpThread.jsx` | `src/components/chat/CpThread.jsx` |
| `ChatHistory.jsx` | `src/components/chat/ChatHistory.jsx` |
| `ChatUserManager.jsx` | `src/components/chat/ChatUserManager.jsx` |
| `BroadcastModal.jsx` | `src/components/chat/BroadcastModal.jsx` |
| `ChatComposer.jsx` | `src/components/ChatComposer.jsx` |
| `ChatErrorBoundary.jsx` | `src/components/ChatErrorBoundary.jsx` |
| `useUnreadChat.js` | `src/hooks/useUnreadChat.js` |
| `useUnreadConversations.js` | `src/hooks/useUnreadConversations.js` |

Their own `import` paths were left untouched and are now wrong — fix them on
restore (they assumed the original locations above).

## To re-enable

1. `git mv` these back to the paths in the table.
2. `npm i @cometchat/chat-sdk-javascript @cometchat/chat-uikit-react @cometchat/calls-sdk-javascript`
   — removed from `package.json` (14 MB of `node_modules`, a 945 KB UIKit
   stylesheet and 8 JS chunks).
3. Uncomment every block tagged `CHAT REMOVED 2026-10-08` in:
   `App.jsx`, `components/Layout.jsx`, `pages/CpApp.jsx`, `pages/Home.jsx`,
   `contexts/AuthContext.jsx`, `api.js`,
   `components/submissions/SubmissionSections.jsx`, `styles.css`.
4. Restore `.home-updates` to `grid-template-columns: 1fr 1.7fr` (see the note
   on that rule).
5. Backend: see `backend/_disabled/chat/README.md`.
