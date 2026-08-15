// @kelearns/dsh-navigation-bar — host half (no-op: the piano navigation bar
// renders entirely in the browser half, see lib/client.js).
//
// This file exists so the profile row declared by cordis.patch.yml loads as a
// valid cordis plugin in the host process. All conversation data is read
// client-side from the official session service (ctx.sessions.binding →
// ConversationSnapshot), so no host routes or storage access are needed.

export const name = 'dsh-navigation-bar'

export const inject = []

export function apply(ctx) {
  if (ctx.logger && typeof ctx.logger.info === 'function') {
    ctx.logger.info('[dsh-navigation-bar] host half active — piano navigation bar renders in the web client')
  }
}
