/* Vérifications du moteur JS de la démo SecureHealth : node tests/test.js */
'use strict';
const S = require('../securehealth.js');
const crypto = require('crypto');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('ÉCHEC : ' + m); } };

// SHA-256 et HMAC contre la bibliothèque crypto de Node (OpenSSL)
for (const s of ['', 'abc', 'é'.repeat(70), 'x'.repeat(1000)]) ok(S.hex(S.sha256(S.utf8(s))) === crypto.createHash('sha256').update(s).digest('hex'), `SHA-256 (${s.length} car.)`);
for (const [k, m] of [['cle', 'msg'], ['k'.repeat(100), 'long'], ['cle-de-demonstration', 'Patient/pat-001']]) ok(S.hex(S.hmacSha256(k, m)) === crypto.createHmac('sha256', k).update(m).digest('hex'), `HMAC ${k.length}`);
// Mêmes pseudonymes et décalages que le Python
const k = 'cle-de-demonstration';
ok(S.pseudonyme(k, 'Patient/pat-001') === '7577fcac931295bb', 'pseudonyme patient = Python');
ok(S.pseudonyme(k, 'https://hopital-demo.example/ipp|IPP100000') === '801fb16b57be8843', 'pseudonyme identifiant = Python');
ok(S.decalageJours(k, 'pat-001') === 8 && S.decalageJours(k, 'pat-002') === -107, 'décalages = Python');
ok(S.decalerDate('2026-03-12T14:30:00+01:00', -170) === '2025-09-23T14:30:00+01:00', 'décalage date-heure = Python');
ok(S.decalerDate('2026-01-03T07:15:00Z', -5) === '2025-12-29T07:15:00Z' && S.decalerDate('1985-07-26', 30) === '1985-08-25', 'décalages = Python (2)');
// LOINC
['8867-4', '59408-5', '8310-5', '2339-0', '718-7', '4548-4', '8480-6'].forEach((c) => ok(S.loincValide(c), `LOINC ${c}`));
['8867-3', '718-6', 'abc-1', '8867', ''].forEach((c) => ok(!S.loincValide(c), `LOINC « ${c} » refusé`));
// Validation
const b = S.lot(20, 4);
ok(S.erreurs(S.valider(b)).length === 0, 'lot fictif valide');
const muter = (type, f) => { const c = JSON.parse(JSON.stringify(b)); f(c.entry.find((e) => e.resource.resourceType === type).resource); return S.erreurs(S.valider(c)); };
[['Patient', (r) => { r.gender = 'homme'; }, 'gender'], ['Patient', (r) => { r.birthDate = '12/03/1990'; }, 'birthDate'], ['Observation', (r) => { r.code.coding[0].code = '8867-3'; }, 'code'],
  ['Observation', (r) => { r.effectiveDateTime = '2026-03-12T14:30:00'; }, 'effectiveDateTime'], ['Observation', (r) => { r.subject.reference = 'Patient/inconnu'; }, 'subject'],
  ['Observation', (r) => { delete r.status; }, 'status'], ['Observation', (r) => { r.valueQuantity.value = '72'; }, 'valueQuantity']].forEach(([t, f, ch]) => {
  const e = muter(t, f); ok(e.length === 1 && e[0].chemin.includes(ch), `erreur repérée : ${t}.${ch}`);
});
// Anonymisation
const a = S.anonymiser(b, k).bundle, txt = JSON.stringify(a);
b.entry.filter((e) => e.resource.resourceType === 'Patient').forEach((e) => {
  const r = e.resource;
  [r.id, r.identifier[0].value, r.telecom[0].value, r.telecom[1].value, r.address[0].line[0], r.address[0].city, r.birthDate].forEach((v) => ok(!txt.includes(`"${v}"`), `« ${v} » a disparu`));
});
ok(!/"(name|telecom|note|text)"/.test(txt), 'champs directs supprimés');
ok(S.erreurs(S.valider(a)).length === 0, 'lot anonymisé valide');
ok(JSON.stringify(S.anonymiser(b, k).bundle) === txt, 'même clé : même résultat');
const p = { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'a', birthDate: '1930-05-02', gender: 'female' } }] };
ok(S.anonymiser(p, k).bundle.entry[0].resource.birthDate === '1936', '90 ans et plus');
const r = S.atteindreK(S.anonymiser(S.lot(40), k).bundle, 5);
ok(r.k >= 5 && r.retires < 20 && S.erreurs(S.valider(r.bundle)).length === 0, `k ≥ 5 atteint (${r.k}, ${r.retires} retirés)`);
console.log(`${n} vérifications, ${bad} échec(s)`);
process.exit(bad ? 1 : 0);
