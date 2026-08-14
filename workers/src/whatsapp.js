// Green API WhatsApp helper — port of scripts/whatsapp.js for CF Workers
// env must have GREENAPI_INSTANCE_ID and GREENAPI_TOKEN.
// groupId must be provided per-call; no implicit fallback to env.WHATSAPP_GROUP_ID.

export function waEnabled(env) {
  return !!(env.GREENAPI_INSTANCE_ID && env.GREENAPI_TOKEN);
}

export async function sendWA(text, env, groupId) {
  if (!waEnabled(env) || !groupId) return;
  const chatId = groupId;
  try {
    const url  = `https://api.green-api.com/waInstance${env.GREENAPI_INSTANCE_ID}/sendMessage/${env.GREENAPI_TOKEN}`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chatId, message: text }),
    });
    if (!resp.ok) console.warn(`WhatsApp send failed: ${resp.status} ${await resp.text()}`);
    else          console.log('WhatsApp message sent');
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
  }
}

export async function sendWAPhoto(photoUrl, caption, env, groupId) {
  if (!waEnabled(env) || !groupId) return;
  if (!photoUrl) { await sendWA(caption, env, groupId); return; }
  const chatId = groupId;
  try {
    const url  = `https://api.green-api.com/waInstance${env.GREENAPI_INSTANCE_ID}/sendFileByUrl/${env.GREENAPI_TOKEN}`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chatId,
        urlFile:  photoUrl,
        fileName: 'match-photo.jpg',
        caption:  caption || '',
      }),
    });
    if (!resp.ok) console.warn(`WhatsApp photo failed: ${resp.status} ${await resp.text()}`);
    else          console.log('WhatsApp photo sent');
  } catch (err) {
    console.error('WhatsApp photo error:', err.message);
  }
}
