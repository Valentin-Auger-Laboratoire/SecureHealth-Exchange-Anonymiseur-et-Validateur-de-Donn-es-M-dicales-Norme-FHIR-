/* SecureHealth : portage JavaScript du moteur Python (validation.py, anonymisation.py, exemples.py).
   SHA-256 et HMAC écrits ici (synchrones) pour obtenir exactement les mêmes pseudonymes que le Python. */
(function (racine) {
  'use strict';

  // --- SHA-256 / HMAC-SHA256 ---
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const utf8 = (s) => new TextEncoder().encode(s);
  function sha256(octets) {
    const l = octets.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb);
    m.set(octets); m[l] = 0x80;
    const bits = l * 8; m[nb - 4] = bits >>> 24; m[nb - 3] = (bits >>> 16) & 255; m[nb - 2] = (bits >>> 8) & 255; m[nb - 1] = bits & 255;
    m[nb - 5] = Math.floor(l / 0x20000000) & 255;
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
    const r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) W[i] = (W[i - 16] + (r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3)) + W[i - 7] + (r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10))) >>> 0;
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32); for (let i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = (H[i] >>> 16) & 255; out[4 * i + 2] = (H[i] >>> 8) & 255; out[4 * i + 3] = H[i] & 255; }
    return out;
  }
  function hmacSha256(cle, msg) {
    let k = typeof cle === 'string' ? utf8(cle) : cle; if (k.length > 64) k = sha256(k);
    const kp = new Uint8Array(64); kp.set(k);
    const ip = kp.map((x) => x ^ 0x36), op = kp.map((x) => x ^ 0x5c), m = utf8(msg);
    const inner = new Uint8Array(64 + m.length); inner.set(ip); inner.set(m, 64);
    const ih = sha256(inner), outer = new Uint8Array(96); outer.set(op); outer.set(ih, 64);
    return sha256(outer);
  }
  const hex = (o) => Array.from(o, (x) => x.toString(16).padStart(2, '0')).join('');
  const pseudonyme = (cle, v, n = 16) => hex(hmacSha256(cle, String(v))).slice(0, n);
  const decalageJours = (cle, id) => parseInt(pseudonyme(cle, 'date:' + id, 8), 16) % 361 - 180;

  // --- Validation ---
  const GENRES = new Set(['male', 'female', 'other', 'unknown']);
  const STATUTS = new Set(['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown']);
  const LOINC = 'http://loinc.org', UCUM = 'http://unitsofmeasure.org';
  const RE_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
  const RE_DT = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
  const RE_ID = /^[A-Za-z0-9\-.]{1,64}$/, RE_LOINC = /^(\d{1,7})-(\d)$/;
  function chiffreLoinc(p) { let t = 0; p.split('').reverse().forEach((c, i) => { let d = +c; if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } t += d; }); return (10 - t % 10) % 10; }
  const loincValide = (c) => { const m = RE_LOINC.exec(c || ''); return !!m && chiffreLoinc(m[1]) === +m[2]; };
  const pb = (l, g, ch, cle, v) => l.push({ gravite: g, chemin: ch, cle, v });
  function validerPatient(p, ch = 'Patient') {
    const l = [];
    if (!RE_ID.test(String(p.id ?? ''))) pb(l, 'erreur', ch + '.id', 'id');
    if ('gender' in p && !GENRES.has(p.gender)) pb(l, 'erreur', ch + '.gender', 'genre', p.gender);
    if ('birthDate' in p && !RE_DATE.test(String(p.birthDate))) pb(l, 'erreur', ch + '.birthDate', 'date');
    (p.identifier || []).forEach((x, i) => { if (!/^(https?:\/\/|urn:)/.test(String(x.system || ''))) pb(l, 'avertissement', `${ch}.identifier[${i}].system`, 'systeme'); });
    return l;
  }
  function validerObservation(o, ch = 'Observation', patients = null) {
    const l = [];
    if (!RE_ID.test(String(o.id ?? ''))) pb(l, 'erreur', ch + '.id', 'id');
    if (!STATUTS.has(o.status)) pb(l, 'erreur', ch + '.status', 'statut');
    const cod = (o.code || {}).coding || [];
    if (!cod.length) pb(l, 'erreur', ch + '.code', 'code');
    cod.forEach((c, i) => { if (c.system === LOINC && !loincValide(c.code)) pb(l, 'erreur', `${ch}.code.coding[${i}].code`, 'loinc', c.code); });
    const ref = (o.subject || {}).reference || '';
    if (!/^Patient\/[A-Za-z0-9\-.]{1,64}$/.test(ref)) pb(l, 'erreur', ch + '.subject', 'ref');
    else if (patients && !patients.has(ref.split('/')[1])) pb(l, 'erreur', ch + '.subject', 'refAbsente', ref);
    if (o.effectiveDateTime !== undefined && !RE_DT.test(String(o.effectiveDateTime))) pb(l, 'erreur', ch + '.effectiveDateTime', 'dateHeure');
    const q = o.valueQuantity;
    if (q !== undefined) {
      if (typeof q.value !== 'number') pb(l, 'erreur', ch + '.valueQuantity.value', 'valeur');
      if (q.system !== UCUM || !q.code) pb(l, 'avertissement', ch + '.valueQuantity', 'ucum');
    }
    return l;
  }
  function valider(r) {
    if (r.resourceType === 'Patient') return validerPatient(r);
    if (r.resourceType === 'Observation') return validerObservation(r);
    if (r.resourceType !== 'Bundle') return [{ gravite: 'erreur', chemin: 'resourceType', cle: 'type', v: r.resourceType }];
    const e = (r.entry || []).map((x) => x.resource || {}), pats = new Set(e.filter((x) => x.resourceType === 'Patient').map((x) => x.id)), l = [];
    e.forEach((x, i) => {
      const ch = `Bundle.entry[${i}].${x.resourceType}`;
      if (x.resourceType === 'Patient') l.push(...validerPatient(x, ch));
      else if (x.resourceType === 'Observation') l.push(...validerObservation(x, ch, pats));
      else pb(l, 'erreur', ch, 'type', x.resourceType);
    });
    return l;
  }
  const erreurs = (l) => l.filter((p) => p.gravite === 'erreur');

  // --- Anonymisation ---
  const DIRECTS = ['name', 'telecom', 'photo', 'contact', 'text'];
  function decalerDate(v, j) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(v);
    if (!m) return v;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + j * 86400000);
    return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}${m[4]}`;
  }
  function anonymiser(bundle, cle, o = {}) {
    const anRef = o.annee || 2026, decaler = o.decalerDates !== false;
    const b = JSON.parse(JSON.stringify(bundle)), rap = {}, plus = (k) => { rap[k] = (rap[k] || 0) + 1; };
    const dec = {}; (b.entry || []).forEach((e) => { if (e.resource.resourceType === 'Patient') dec[e.resource.id] = decalageJours(cle, e.resource.id); });
    (b.entry || []).forEach((e) => {
      delete e.fullUrl; const r = e.resource;
      DIRECTS.forEach((c) => { if (r[c] !== undefined && r[c] !== null) { delete r[c]; plus(c); } });
      if (r.resourceType === 'Patient') {
        (r.identifier || []).forEach((x) => { x.value = pseudonyme(cle, (x.system || '') + '|' + x.value); plus('identifiant'); });
        if (r.birthDate) {
          const a = +r.birthDate.slice(0, 4);
          if (anRef - a <= 89) r.birthDate = String(a); else { r.birthDate = String(anRef - 90); r.extension = [{ url: 'urn:securehealth:age', valueString: '90 ans et plus' }]; }
          plus('naissance');
        }
        if (r.address) { r.address = r.address.filter((x) => String(x.postalCode || '').length >= 2).map((x) => ({ postalCode: String(x.postalCode).slice(0, 2) + '000', country: x.country || 'FR' })); plus('adresse'); }
        if (r.deceasedDateTime && decaler) r.deceasedDateTime = decalerDate(r.deceasedDateTime, dec[r.id]);
        r.id = pseudonyme(cle, 'Patient/' + r.id);
      } else if (r.resourceType === 'Observation') {
        const ref = (r.subject || {}).reference || '', ancien = ref.includes('/') ? ref.split('/')[1] : null;
        if (ancien !== null) r.subject = { reference: 'Patient/' + pseudonyme(cle, 'Patient/' + ancien) };
        delete r.note; delete r.performer;
        if (r.effectiveDateTime && decaler) { r.effectiveDateTime = decalerDate(r.effectiveDateTime, dec[ancien] || 0); plus('date'); }
        r.id = pseudonyme(cle, 'Observation/' + r.id);
      }
    });
    return { bundle: b, rapport: rap };
  }
  const quasi = (p) => [String(p.birthDate || '?').slice(0, 4), p.gender || '?', String(((p.address || [])[0] || {}).postalCode || '?').slice(0, 2)].join('|');
  function kAnonymat(b) {
    const g = new Map(); (b.entry || []).forEach((e) => { if (e.resource.resourceType === 'Patient') { const q = quasi(e.resource); g.set(q, (g.get(q) || 0) + 1); } });
    return { k: g.size ? Math.min(...g.values()) : 0, groupes: g };
  }
  function generaliserAnnees(b0, pas) {
    const b = JSON.parse(JSON.stringify(b0));
    b.entry.forEach((e) => { const r = e.resource; if (r.resourceType === 'Patient' && /^\d+$/.test(r.birthDate || '')) { const a = +r.birthDate; r.birthDate = String(a - a % pas); r.extension = (r.extension || []).filter((x) => x.url !== 'urn:securehealth:tranche').concat([{ url: 'urn:securehealth:tranche', valueString: `${a - a % pas}-${a - a % pas + pas - 1}` }]); } });
    return b;
  }
  function retirerDepartement(b0) { const b = JSON.parse(JSON.stringify(b0)); b.entry.forEach((e) => { if (e.resource.resourceType === 'Patient') delete e.resource.address; }); return b; }
  function atteindreK(b0, kc = 5) {
    let b = b0; const etapes = [];
    for (const [nom, f] of [['ans10', (x) => generaliserAnnees(x, 10)], ['ans20', (x) => generaliserAnnees(x, 20)], ['dept', retirerDepartement]]) {
      if (kAnonymat(b).k >= kc) break; b = f(b); etapes.push({ cle: nom });
    }
    let { k, groupes } = kAnonymat(b), retires = 0;
    if (k < kc) {
      const rares = new Set([...groupes].filter(([, c]) => c < kc).map(([q]) => q));
      const ids = new Set(b.entry.filter((e) => e.resource.resourceType === 'Patient' && rares.has(quasi(e.resource))).map((e) => e.resource.id));
      retires = ids.size;
      b = JSON.parse(JSON.stringify(b));
      b.entry = b.entry.filter((e) => !ids.has(e.resource.id) && !ids.has(((e.resource.subject || {}).reference || '').split('/').pop()));
      etapes.push({ cle: 'retrait', v: retires }); k = kAnonymat(b).k;
    }
    return { bundle: b, etapes, k, retires };
  }

  // --- Lot fictif ---
  const PRENOMS = ['Camille', 'Louis', 'Inès', 'Hugo', 'Léa', 'Nathan', 'Chloé', 'Adam', 'Manon', 'Jules'];
  const NOMS = ['Martin', 'Bernard', 'Durand', 'Petit', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Garnier', 'Faure'];
  const VILLES = [['91000', 'Évry-Courcouronnes'], ['91100', 'Corbeil-Essonnes'], ['75013', 'Paris'], ['94000', 'Créteil'], ['92100', 'Boulogne-Billancourt']];
  const MESURES = [['8867-4', 'Fréquence cardiaque', '/min', 60, 100], ['59408-5', 'SpO2', '%', 93, 99], ['8310-5', 'Température corporelle', 'Cel', 36.2, 38.4], ['2339-0', 'Glucose sanguin', 'mg/dL', 70, 160]];
  function rng(graine) { let a = graine >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function lot(n = 40, graine = 0) {
    const u = rng(graine + 1), ch = (a) => a[Math.floor(u() * a.length)], ent = (a, b) => a + Math.floor(u() * (b - a + 1)), e = [];
    for (let i = 0; i < n; i++) {
      const pid = `pat-${String(i + 1).padStart(3, '0')}`, [cp, ville] = ch(VILLES), annee = ent(1932, 2004);
      e.push({ fullUrl: `urn:uuid:${pid}`, resource: { resourceType: 'Patient', id: pid,
        identifier: [{ system: 'https://hopital-demo.example/ipp', value: `IPP${100000 + i}` }], name: [{ family: ch(NOMS), given: [ch(PRENOMS)] }],
        telecom: [{ system: 'phone', value: `01 99 00 ${String(Math.floor(i / 100)).padStart(2, '0')} ${String(i % 100).padStart(2, '0')}` }, { system: 'email', value: `patient${i + 1}@exemple.fr` }],
        gender: ch(['male', 'female']), birthDate: `${annee}-${String(ent(1, 12)).padStart(2, '0')}-${String(ent(1, 28)).padStart(2, '0')}`,
        address: [{ line: [`${ent(1, 120)} rue de la Démo`], city: ville, postalCode: cp, country: 'FR' }], text: { status: 'generated', div: '<div>Patient fictif</div>' } } });
      for (let k = 0; k < 3; k++) {
        const [code, lib, un, lo, hi] = ch(MESURES);
        e.push({ fullUrl: `urn:uuid:${pid}-obs${k}`, resource: { resourceType: 'Observation', id: `${pid}-obs${k}`, status: 'final',
          code: { coding: [{ system: LOINC, code, display: lib }] }, subject: { reference: `Patient/${pid}` },
          effectiveDateTime: `2026-03-${String(ent(1, 28)).padStart(2, '0')}T${String(ent(7, 19)).padStart(2, '0')}:${ch(['00', '15', '30', '45'])}:00+01:00`,
          valueQuantity: { value: Math.round((lo + u() * (hi - lo)) * 10) / 10, unit: un, system: UCUM, code: un }, note: [{ text: `Mesure prise par l'infirmière de garde pour ${pid}` }] } });
      }
    }
    return { resourceType: 'Bundle', type: 'collection', entry: e };
  }

  const api = { sha256, hmacSha256, hex, utf8, pseudonyme, decalageJours, chiffreLoinc, loincValide, valider, erreurs, decalerDate, anonymiser, kAnonymat, generaliserAnnees, retirerDepartement, atteindreK, lot, quasi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else racine.SecureHealth = api;
})(typeof window !== 'undefined' ? window : globalThis);
