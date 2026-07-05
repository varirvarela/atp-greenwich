// src/player/avatars.js — DiceBear avatar generation for ATP Greenwich
// avatarId format: "style::seed"              — seed-based colors (random)
//                  "style::seed::hair::skin"   — explicit hair + skin hex colors (no #)

import { createAvatar } from '@dicebear/core';
import * as adventurer from '@dicebear/adventurer';
import * as bigSmile   from '@dicebear/big-smile';
import * as pixelArt   from '@dicebear/pixel-art';
import { escHtml } from '@shared/utils.js';

// ─── Style catalogue ──────────────────────────────────────────────────────────
const STYLES = {
  'adventurer': { schema: adventurer, label: 'Adventurer', desc: 'Retro cartoon' },
  'big-smile':  { schema: bigSmile,   label: 'Big Smile',  desc: 'Chunky & fun'  },
  'pixel-art':  { schema: pixelArt,   label: 'Pixel Art',  desc: 'Retro game'    },
};

export const STYLE_IDS = Object.keys(STYLES);

// ─── Color palettes per style (DiceBear v9 defaults) ─────────────────────────
const COLOR_OPTIONS = {
  'adventurer': {
    hair: ['ac6511','cb6820','ab2a18','e5d7a3','b9a05f','796a45','6a4e35','562306','0e0e0e','afafaf','3eac2c','85c2c6','dba3be','592454'],
    skin: ['f2d3b1','ecad80','9e5622','763900'],
  },
  'big-smile': {
    hair: ['220f00','3a1a00','71472d','e2ba87','605de4','238d80','d56c0c','e9b729'],
    skin: ['ffe4c0','f5d7b1','efcc9f','e2ba87','c99c62','a47539','8c5a2b','643d19'],
  },
  'pixel-art': {
    hair: ['cab188','603a14','83623b','a78961','611c17','603015','612616','28150a','009bbd','bd1700','91cb15'],
    skin: ['ffdbac','f5cfa0','eac393','e0b687','cb9e6e','b68655','a26d3d','8d5524'],
  },
};

// ─── Seed generation ──────────────────────────────────────────────────────────
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
// Returns an HTML string: a circular div wrapping the DiceBear avatar.
export function avatarToSvg(avatarId, size) {
  const sz  = size || 40;
  const raw = _generateRawSvg(avatarId, sz);
  return `<div style="width:${sz}px;height:${sz}px;border-radius:50%;overflow:hidden;flex-shrink:0;background:#f0ebe2;">${raw}</div>`;
}

// ─── Avatar picker component ──────────────────────────────────────────────────
// initialAvatarId: full avatarId (style::seed or style::seed::hair::skin) or a
//                  raw seed/uid string. If omitted, starts with adventurer + new seed.
export function renderAvatarPicker(container, takenIds, onSelect, initialAvatarId, validateFn) {
  // Parse initial state from avatarId if provided
  const parts = (initialAvatarId || '').split('::');
  let currentStyle = STYLES[parts[0]] ? parts[0] : 'adventurer';
  let currentSeed  = parts[1] || initialAvatarId || generateSeed();
  // null = Auto (seed-driven); both must be set together or neither
  let currentHair  = (parts[2] && parts[3]) ? parts[2] : null;
  let currentSkin  = (parts[2] && parts[3]) ? parts[3] : null;

  function avatarId() {
    return (currentHair && currentSkin)
      ? `${currentStyle}::${currentSeed}::${currentHair}::${currentSkin}`
      : `${currentStyle}::${currentSeed}`;
  }

  function updatePreview() {
    const el = container.querySelector('#av-preview-inner');
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'scale(0.88)';
    setTimeout(() => {
      el.innerHTML = _generateRawSvg(avatarId(), 136);
      el.style.opacity = '1';
      el.style.transform = 'scale(1)';
    }, 100);
  }

  function _updateSwatchHighlights() {
    container.querySelectorAll('[data-hair-swatch]').forEach(btn => {
      const isAuto  = btn.dataset.hairSwatch === 'auto';
      const isMatch = isAuto ? currentHair === null : btn.dataset.hairSwatch === currentHair;
      btn.style.outline = isMatch ? '2px solid var(--ace)' : '2px solid transparent';
      btn.style.outlineOffset = '2px';
    });
    container.querySelectorAll('[data-skin-swatch]').forEach(btn => {
      const isAuto  = btn.dataset.skinSwatch === 'auto';
      const isMatch = isAuto ? currentSkin === null : btn.dataset.skinSwatch === currentSkin;
      btn.style.outline = isMatch ? '2px solid var(--ace)' : '2px solid transparent';
      btn.style.outlineOffset = '2px';
    });
  }

  function _colorRow(type, colors, currentVal) {
    const autoSelected = currentVal === null;
    return `
      <div style="margin-bottom:12px;">
        <div class="t-label t-muted" style="margin-bottom:8px;">
          ${type === 'hair' ? 'Hair' : 'Skin'} Color
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <button data-${type}-swatch="auto" title="Auto"
            style="width:26px;height:26px;border-radius:50%;background:conic-gradient(#ac6511 0deg,#f2d3b1 90deg,#0e0e0e 180deg,#9e5622 270deg);
              border:none;cursor:pointer;padding:0;flex-shrink:0;box-shadow:0 0 0 1px rgba(0,0,0,.15);
              outline:${autoSelected ? '2px solid var(--ace)' : '2px solid transparent'};outline-offset:2px;"
            title="Auto — color from seed">
          </button>
          ${colors.map(hex => `
            <button data-${type}-swatch="${escHtml(hex)}" title="#${escHtml(hex)}"
              style="width:26px;height:26px;border-radius:50%;background:#${escHtml(hex)};
                border:none;cursor:pointer;padding:0;flex-shrink:0;
                box-shadow:0 0 0 1px rgba(0,0,0,.15);
                outline:${currentVal === hex ? '2px solid var(--ace)' : '2px solid transparent'};outline-offset:2px;">
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function render() {
    const palette = COLOR_OPTIONS[currentStyle];
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;padding-bottom:16px;">

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
              ${_generateRawSvg(avatarId(), 136)}
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

        <!-- Color pickers -->
        <div style="padding:0 2px;">
          ${_colorRow('hair', palette.hair, currentHair)}
          ${_colorRow('skin', palette.skin, currentSkin)}
        </div>

        <div id="av-conflict-msg" style="display:none;text-align:center;font-size:13px;
          color:var(--ace3);background:var(--ace3-bg);border-radius:8px;padding:8px 12px;">
        </div>

        <button class="btn btn-primary" id="btn-confirm">This is me →</button>

      </div>
    `;

    // Style tab clicks
    container.querySelectorAll('[data-style]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentStyle = btn.dataset.style;
        currentSeed  = generateSeed();
        // Reset colors to Auto when switching styles (palettes differ)
        currentHair = null;
        currentSkin = null;
        container.querySelectorAll('[data-style]').forEach(b => {
          b.classList.toggle('active', b.dataset.style === currentStyle);
        });
        _hideConflict();
        // Re-render color rows since palette changed
        render();
      });
    });

    // Shuffle — new seed, keep color selection
    container.querySelector('#btn-shuffle').addEventListener('click', () => {
      currentSeed = generateSeed();
      _hideConflict();
      updatePreview();
    });

    // Hair color swatches
    container.querySelectorAll('[data-hair-swatch]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.hairSwatch;
        if (val === 'auto') {
          currentHair = null;
          currentSkin = null;
        } else {
          currentHair = val;
          if (currentSkin === null) {
            currentSkin = COLOR_OPTIONS[currentStyle].skin[0];
          }
        }
        _updateSwatchHighlights();
        updatePreview();
      });
    });

    // Skin color swatches
    container.querySelectorAll('[data-skin-swatch]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.skinSwatch;
        if (val === 'auto') {
          currentHair = null;
          currentSkin = null;
        } else {
          currentSkin = val;
          if (currentHair === null) {
            currentHair = COLOR_OPTIONS[currentStyle].hair[0];
          }
        }
        _updateSwatchHighlights();
        updatePreview();
      });
    });

    // Confirm
    container.querySelector('#btn-confirm').addEventListener('click', async () => {
      if (!validateFn) { onSelect(avatarId()); return; }

      const btn = container.querySelector('#btn-confirm');
      btn.disabled = true;
      btn.textContent = 'Checking…';

      const result = await validateFn(avatarId());

      if (result === true) {
        onSelect(avatarId());
      } else {
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
  const parts   = (avatarId || '').split('::');
  const styleId = parts[0];
  const seed    = parts[1] || 'default';
  const hairHex = parts[2] || null;
  const skinHex = parts[3] || null;

  const entry = STYLES[styleId] || STYLES['adventurer'];
  const sz    = renderSz || 40;

  const opts = { seed };
  if (hairHex) opts.hairColor = [hairHex];
  if (skinHex) opts.skinColor = [skinHex];

  try {
    const svg = createAvatar(entry.schema, opts).toString();
    // Use data URI + <img> tag: the most reliable cross-browser/iOS-Safari approach.
    // SVG attribute dimensions are inconsistently honoured inside flex containers on
    // iOS Safari; <img width height> is always respected by every browser.
    const dataUri = 'data:image/svg+xml,' + encodeURIComponent(svg);
    return `<img src="${dataUri}" width="${sz}" height="${sz}" alt=""
      style="width:${sz}px;height:${sz}px;display:block;flex-shrink:0;">`;
  } catch {
    return _fallbackSvg(sz);
  }
}

function _fallbackSvg(sz) {
  return `<svg width="${sz}" height="${sz}" style="width:${sz}px;height:${sz}px;display:block;" viewBox="0 0 ${sz} ${sz}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${sz}" height="${sz}" fill="#f0ebe2"/>
    <circle cx="${sz/2}" cy="${sz*0.38}" r="${sz*0.18}" fill="#c8bfb0"/>
    <ellipse cx="${sz/2}" cy="${sz*0.72}" rx="${sz*0.27}" ry="${sz*0.16}" fill="#c8bfb0"/>
  </svg>`;
}
