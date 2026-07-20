// Green API WhatsApp helper — port of scripts/whatsapp.js for CF Workers
// env must have GREENAPI_INSTANCE_ID, GREENAPI_TOKEN, WHATSAPP_GROUP_ID

export function waEnabled(env) {
  return !!(env.GREENAPI_INSTANCE_ID && env.GREENAPI_TOKEN && env.WHATSAPP_GROUP_ID);
}

export async function sendWA(text, env) {
  if (!waEnabled(env)) return;
  try {
    const url  = `https://api.green-api.com/waInstance${env.GREENAPI_INSTANCE_ID}/sendMessage/${env.GREENAPI_TOKEN}`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chatId: env.WHATSAPP_GROUP_ID, message: text }),
    });
    if (!resp.ok) console.warn(`WhatsApp send failed: ${resp.status} ${await resp.text()}`);
    else          console.log('WhatsApp message sent');
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
  }
}

export async function sendWAPhoto(photoUrl, caption, env) {
  if (!waEnabled(env)) return;
  if (!photoUrl) { await sendWA(caption, env); return; }
  try {
    const url  = `https://api.green-api.com/waInstance${env.GREENAPI_INSTANCE_ID}/sendFileByUrl/${env.GREENAPI_TOKEN}`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chatId:   env.WHATSAPP_GROUP_ID,
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
