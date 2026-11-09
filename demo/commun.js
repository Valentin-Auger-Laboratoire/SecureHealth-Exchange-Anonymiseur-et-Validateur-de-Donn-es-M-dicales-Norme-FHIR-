/* Outils communs aux démos : langue (FR / EN mémorisée) et graphiques sur canvas. */
(function () {
  'use strict';

  function langueInitiale() {
    try {
      return (localStorage.getItem('langChoix') === 'fr' ? 'fr' : 'en');
    } catch (e) { return 'en'; }
  }

  // T = { fr: {...}, en: {...} } ; les éléments portent data-t="clé" (texte) ou data-th (HTML).
  function Langue(T, surChangement) {
    let lang = langueInitiale();
    const t = (k) => (T[lang] && T[lang][k] !== undefined ? T[lang][k] : (T.fr[k] !== undefined ? T.fr[k] : k));
    function appliquer(l) {
      lang = l === 'en' ? 'en' : 'fr';
      document.documentElement.lang = lang;
      document.querySelectorAll('[data-t]').forEach((e) => { e.textContent = t(e.dataset.t); });
      document.querySelectorAll('[data-th]').forEach((e) => { e.innerHTML = t(e.dataset.th); });
      document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
      try { localStorage.setItem('lang', lang); localStorage.setItem('langChoix', lang); } catch (e) {}
      if (surChangement) surChangement(lang);
    }
    document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => appliquer(b.dataset.lang)));
    return { t, appliquer, get lang() { return lang; } };
  }

  const nf = (x, d, lang) => (Number.isFinite(x) ? x.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

  function preparer(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, r.width), h = Math.max(10, r.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function graduations(a, b, n) {
    const pas0 = (b - a) / Math.max(1, n);
    const p = Math.pow(10, Math.floor(Math.log10(pas0)));
    const pas = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= pas0) || 10 * p;
    const out = [];
    for (let v = Math.ceil(a / pas) * pas; v <= b + 1e-9 * pas; v += pas) out.push(+v.toPrecision(12));
    return out;
  }

  /* Graphique cartésien. opts : { xmin, xmax, ymin, ymax, xlabel, ylabel, series: [{x, y, color, width, step, dash, points}],
     bandes: [{y0, y1, color}], vlignes: [{x, color, dash}], hlignes: [{y, color, dash}], marques: [{x, y, color, r}] } */
  function graphique(canvas, o) {
    const { ctx, w, h } = preparer(canvas);
    const g = { l: 52, r: 12, t: 10, b: 30 };
    const X = (x) => g.l + (x - o.xmin) / (o.xmax - o.xmin) * (w - g.l - g.r);
    const Y = (y) => h - g.b - (y - o.ymin) / (o.ymax - o.ymin) * (h - g.t - g.b);
    ctx.font = '11px "JetBrains Mono", monospace';
    (o.bandes || []).forEach((bd) => {
      ctx.fillStyle = bd.color;
      const ya = Y(Math.min(bd.y1, o.ymax)), yb = Y(Math.max(bd.y0, o.ymin));
      ctx.fillRect(g.l, ya, w - g.l - g.r, yb - ya);
    });
    ctx.strokeStyle = '#26262a'; ctx.fillStyle = '#8a8a8e'; ctx.lineWidth = 1;
    graduations(o.xmin, o.xmax, Math.max(3, Math.floor((w - g.l) / 80))).forEach((v) => {
      ctx.beginPath(); ctx.moveTo(X(v), g.t); ctx.lineTo(X(v), h - g.b); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(o.fmtx ? o.fmtx(v) : String(v), X(v), h - g.b + 14);
    });
    graduations(o.ymin, o.ymax, Math.max(3, Math.floor((h - g.b) / 40))).forEach((v) => {
      ctx.beginPath(); ctx.moveTo(g.l, Y(v)); ctx.lineTo(w - g.r, Y(v)); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(o.fmty ? o.fmty(v) : String(v), g.l - 6, Y(v) + 4);
    });
    if (o.xlabel) { ctx.textAlign = 'right'; ctx.fillText(o.xlabel, w - g.r, h - 4); }
    if (o.ylabel) { ctx.save(); ctx.translate(12, g.t); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(o.ylabel, 0, 0); ctx.restore(); }
    ctx.save();
    ctx.beginPath(); ctx.rect(g.l, g.t, w - g.l - g.r, h - g.t - g.b); ctx.clip();
    const ligne = (x, color, dash, vertical) => {
      ctx.strokeStyle = color; ctx.setLineDash(dash || []); ctx.beginPath();
      if (vertical) { ctx.moveTo(X(x), g.t); ctx.lineTo(X(x), h - g.b); } else { ctx.moveTo(g.l, Y(x)); ctx.lineTo(w - g.r, Y(x)); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    (o.hlignes || []).forEach((l) => ligne(l.y, l.color || '#6c6c70', l.dash, false));
    (o.vlignes || []).forEach((l) => ligne(l.x, l.color || '#6c6c70', l.dash, true));
    (o.series || []).forEach((s) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6; ctx.setLineDash(s.dash || []);
      if (s.points) {
        ctx.fillStyle = s.color;
        for (let i = 0; i < s.x.length; i++) { ctx.beginPath(); ctx.arc(X(s.x[i]), Y(s.y[i]), s.r || 3, 0, 7); ctx.fill(); }
      } else {
        ctx.beginPath();
        for (let i = 0; i < s.x.length; i++) {
          const px = X(s.x[i]), py = Y(s.y[i]);
          if (i === 0) ctx.moveTo(px, py);
          else if (s.step) { ctx.lineTo(px, Y(s.y[i - 1])); ctx.lineTo(px, py); }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.lineWidth = 1;
    });
    (o.marques || []).forEach((m) => { ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), m.r || 5, 0, 7); ctx.fill(); });
    ctx.restore();
    return { X, Y, ctx, w, h, g };
  }

  window.Commun = { Langue, nf, graphique, preparer, graduations };
})();
