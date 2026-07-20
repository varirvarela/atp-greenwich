import { runSendPush }    from './send-push.js';
import { runDailyDigest } from './daily-digest.js';

export default {
  async fetch() {
    return new Response('ATP Greenwich Worker — cron only', { status: 200 });
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(runSendPush(env));
    } else {
      ctx.waitUntil(runDailyDigest(env));
    }
  },
};
