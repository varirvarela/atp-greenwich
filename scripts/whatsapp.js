// scripts/whatsapp.js — Green API WhatsApp helper (shared by send-push and daily-digest)
'use strict';

const fetch = require('node-fetch');

const WA_INSTANCE = process.env.GREENAPI_INSTANCE_ID;
const WA_TOKEN    = process.env.GREENAPI_TOKEN;
const WA_GROUP    = process.env.WHATSAPP_GROUP_ID;

const waEnabled = !!(WA_INSTANCE && WA_TOKEN && WA_GROUP);

async function sendWA(text) {
  if (!waEnabled) return;
  try {
    const url  = `https://api.green-api.com/waInstance${WA_INSTANCE}/sendMessage/${WA_TOKEN}`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chatId: WA_GROUP, message: text }),
    });
    if (!resp.ok) console.warn(`WhatsApp send failed: ${resp.status} ${await resp.text()}`);
    else          console.log('WhatsApp message sent');
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
  }
}

// Sends a photo (by public URL) with an optional caption.
// Falls back to plain text if the URL is missing.
async function sendWAPhoto(photoUrl, caption) {
  if (!waEnabled) return;
  if (!photoUrl) { await sendWA(caption); return; }
  try {
    const url  = `https://api.green-api.com/waInstance${WA_INSTANCE}/sendFileByUrl/${WA_TOKEN}`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chatId:   WA_GROUP,
        urlFile:  photoUrl,
        fileName: 'match-photo.jpg',
        caption:  caption || '',
      }),
    });
    if (!resp.ok) console.warn(`WhatsApp photo send failed: ${resp.status} ${await resp.text()}`);
    else          console.log('WhatsApp photo sent');
  } catch (err) {
    console.error('WhatsApp photo send error:', err.message);
  }
}

module.exports = { sendWA, sendWAPhoto, waEnabled };
