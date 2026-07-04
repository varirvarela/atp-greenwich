// src/player/avatars.js — DiceBear avatar generation for ATP Greenwich
// avatarId format: "style::seed"  e.g. "adventurer::x7f3k2p9ab4d"
// Seed is random; same seed + style always produces the same avatar.

import { createAvatar } from '@dicebear/core';
import * as adventurer from '@dicebear/adventurer';
import * as bigSmile   from '@dicebear/big-smile';
import * as pixelArt   from '@dicebear/pixel-art';
import { escHtml } from '@shared/utils.js';

// ─── Style catalogue ──────────────────────────────────────────────────────────
const STYLES = {
  'adventurer': { schema: adventurer, label: 'Adventurer', desc: 'Retro cartoon'  },
  'big-smile':  { schema: bigSmile,   label: 'Big Smile',  desc: 'Chunky & fun'   },
  'pixel-art':  { schema: pixelArt,   label: 'Pixel Art',  desc: 'Retro game'     },
};

export const STYLE_IDS = Object.keys(STYLES);

// ─── Seed generation ──────────────────────────────────────────────────────────
// Uses crypto.getRandomValues when available (browser), falls back to Math.random.
// 16 chars from a 31-char alphabet → ~80 bits of entropy → collision essentially impossible.

export function generateSeed() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let seed = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 16; i++) seed += chars[bytes[i] % chars.length];
  } else {
    for (let i = 0; i < 16; i++) seed += chars[Math.floor(Math.random() * chars.length)];
  }
  return seed;
}

// ─── Core render ─────────────────────────────────────────────────────────────

// Returns an HTML string: a circular div wrapping the DiceBear SVG.
// Safe to put directly into innerHTML.
export function avatarToSvg(avatarId, size) {
  const sz  = size || 40;
  const raw = _generateRawSvg(avatarId, sz);
  return `<div style="width:${sz}px;height:${sz}px;border-radius:50%;overflow:hidden;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;background:#f0ebe2;">${raw}</div>`;
}

// ─── Avatar picker component ──────────────────────────────────────────────────
// Renders the full picker UI into `container`.
//
// initialSeed: optional starting seed (pass player uid for personalised first look)
// onSelect:    callback(avatarId) called when user confirms
// validateFn:  optional async (avatarId) => true | errorString
//              return true to proceed; return a string to block + auto-reshuffle
//
// takenIds is kept for API compatibility but ignored — random seeds make
// collisions essentially impossible; validateFn handles the rare duplicate case.

export function renderAvatarPicker(container, takenIds, onSelect, initialSeed, validateFn) {
  let currentStyle = 'adventurer';
  let currentSeed  = initialSeed || generateSeed();

  function avatarId()  { return `${currentStyle}::${currentSeed}`; }
  function previewSvg(sz) { return _generateRawSvg(avatarId(), sz); }

  function updatePreview() {
    const el = container.querySelector('#av-preview-inner');
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'scale(0.88)';
    // brief animation before swapping content
    setTimeout(() => {
      el.innerHTML = previewSvg(136);
      el.style.opacity = '1';
      el.style.transform = 'scale(1)';
    }, 100);
  }

  function render() {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;padding-bottom:16px;">

        <!-- Style tabs -->
        <div>
          <div class="t-label t-muted" style="text-align:center;margin-bottom:10px;">Style</div>
          <div style="display:flex;gap:8px;">
            ${STYLE_IDS.map(id => {
              const s = STYLES[id];
              return `<button
                class="pill${id === currentStyle ? ' active' : ''}"
                data-style="${escHtml(id)}"
                style="flex:1;flex-direction:column;gap:2px;padding:10px 6px;height:auto;text-align:center;">
                <span style="font-size:13px;font-weight:700;">${escHtml(s.label)}</span>
                <span style="font-size:10px;font-weight:400;opacity:.7;font-family:var(--font-mono);">${escHtml(s.desc)}</span>
              </button>`;
            }).join('')}
          </div>
        </div>

        <!-- Preview -->
        <div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
          <div style="width:136px;height:136px;border-radius:50%;overflow:hidden;
            border:3px solid var(--border);background:#f0ebe2;">
            <div id="av-preview-inner"
              style="width:100%;height:100%;transition:opacity 0.12s ease,transform 0.12s ease;">
              ${previewSvg(136)}
            </div>
          </div>

          <button class="btn btn-surface" id="btn-shuffle"
            style="width:auto;padding:10px 28px;gap:8px;font-size:14px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22"/>
              <path d="m18 2 4 4-4 4"/>
              <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/>
              <path d="M22 18h-5.9c-1.3 0-2.5-.6-3.3-1.7l-.5-.8"/>
              <path d="m18 14 4 4-4 4"/>
            </svg>
            Shuffle
          </button>
        </div>

        <div id="av-conflict-msg" style="display:none;text-align:center;font-size:13px;
          color:var(--ace3);background:var(--ace3-bg);border-radius:8px;padding:8px 12px;">
        </div>

        <button class="btn btn-primary" id="btn-confirm">This is me →</button>

      </div>
    `;

    // Style tab clicks — new seed on style change so preview feels fresh
    container.querySelectorAll('[data-style]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentStyle = btn.dataset.style;
        currentSeed  = generateSeed();
        container.querySelectorAll('[data-style]').forEach(b => {
          b.classList.toggle('active', b.dataset.style === currentStyle);
        });
        _hideConflict();
        updatePreview();
      });
    });

    // Shuffle — new seed, animate preview
    container.querySelector('#btn-shuffle').addEventListener('click', () => {
      currentSeed = generateSeed();
      _hideConflict();
      updatePreview();
    });

    // Confirm — validate for duplicates if validateFn provided
    container.querySelector('#btn-confirm').addEventListener('click', async () => {
      if (!validateFn) { onSelect(avatarId()); return; }

      const btn = container.querySelector('#btn-confirm');
      btn.disabled = true;
      btn.textContent = 'Checking…';

      const result = await validateFn(avatarId());

      if (result === true) {
        onSelect(avatarId());
      } else {
        // Show conflict message, auto-shuffle to a new seed
        const msgEl = container.querySelector('#av-conflict-msg');
        if (msgEl) {
          msgEl.textContent = typeof result === 'string' ? result : 'Already taken — try another!';
          msgEl.style.display = 'block';
        }
        currentSeed = generateSeed();
        updatePreview();
        btn.disabled = false;
        btn.textContent = 'This is me →';
      }
    });

    function _hideConflict() {
      const msgEl = container.querySelector('#av-conflict-msg');
      if (msgEl) msgEl.style.display = 'none';
    }
  }

  render();
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function _generateRawSvg(avatarId, renderSz) {
  const [styleId, seed] = (avatarId || '').split('::');
  const entry = STYLES[styleId] || STYLES['adventurer'];
  const opts  = { seed: seed || 'default' };
  const sz    = renderSz || 40;
  try {
    const svg = createAvatar(entry.schema, opts).toString();
    // Use explicit pixel dimensions so the browser scales the viewBox correctly.
    // Using width="100%" can cause the SVG to render at its natural viewBox size
    // (762×762 for adventurer) and overflow the circular container.
    return svg.replace('<svg ', `<svg width="${sz}" height="${sz}" `);
  } catch {
    return _fallbackSvg(sz);
  }
}

function _fallbackSvg(sz) {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${sz}" height="${sz}" fill="#f0ebe2"/>
    <circle cx="${sz/2}" cy="${sz*0.38}" r="${sz*0.18}" fill="#c8bfb0"/>
    <ellipse cx="${sz/2}" cy="${sz*0.72}" rx="${sz*0.27}" ry="${sz*0.16}" fill="#c8bfb0"/>
  </svg>`;
}
