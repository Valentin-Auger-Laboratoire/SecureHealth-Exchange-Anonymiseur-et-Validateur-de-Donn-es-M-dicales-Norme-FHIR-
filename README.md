# SecureHealth Exchange : validation et anonymisation de données médicales FHIR

🇫🇷 [Français](#français) · 🇬🇧 [English](#english)

> Données **fictives** (noms inventés, téléphones de la plage 01 99 00 réservée à la fiction). Outil d'étude : un vrai projet de partage de données de santé passe par un DPO et une analyse d'impact (AIPD).

---

## Français

### Le problème
Un hôpital veut partager des données avec une équipe de recherche, au format d'échange **FHIR** (la norme internationale des dossiers de santé). Avant l'envoi, il faut :
1. **vérifier** que les données sont correctes, sinon le destinataire les rejette ou, pire, les interprète mal ;
2. **anonymiser** : retirer ce qui identifie directement le patient, tout en gardant ce qui est utile à l'étude ;
3. **mesurer le risque de réidentification**, parce qu'on peut parfois retrouver quelqu'un en croisant son âge, son sexe et son lieu de vie.

### Ce que fait le code
**Validation** (Patient, Observation, Bundle), avec un résultat de la forme d'un OperationOutcome :
- champs obligatoires et valeurs autorisées (sexe, statut d'observation) ;
- formats de date et de date-heure (fuseau horaire obligatoire) ;
- références entre ressources (une observation doit pointer vers un patient présent dans le lot) ;
- **codes LOINC** contrôlés par leur chiffre de contrôle (modulo 10) ;
- valeurs numériques et unités UCUM.

**Anonymisation** :
- suppression des identifiants directs : nom, téléphone, e-mail, adresse précise, texte libre, notes ;
- **pseudonymes HMAC-SHA256** avec une clé secrète : un même patient garde le même pseudonyme dans tout le lot, et les références restent cohérentes, mais on ne peut pas remonter à l'identité sans la clé ;
- date de naissance réduite à l'année, « 90 ans et plus » au-delà de 89 ans ;
- code postal réduit au département ;
- **décalage des dates** propre à chaque patient (entre −180 et +180 jours) : les intervalles entre examens sont conservés, ce qui compte pour la recherche.

**k-anonymat** sur les quasi-identifiants (année de naissance, sexe, département) : l'outil généralise pas à pas (tranches de 10 ans, puis 20 ans, puis plus de département), puis retire les patients qui restent trop rares, jusqu'à ce que chacun soit confondu avec au moins k − 1 autres.

### Exemple
Avant :
```json
{ "id": "pat-001", "identifier": [{ "value": "IPP100000" }],
  "name": [{ "family": "Martin", "given": ["Léa"] }],
  "telecom": [{ "value": "01 99 00 00 00" }, { "value": "patient1@exemple.fr" }],
  "gender": "female", "birthDate": "1985-07-26",
  "address": [{ "line": ["107 rue de la Démo"], "city": "Créteil", "postalCode": "94000" }] }
```
Après :
```json
{ "id": "7577fcac931295bb", "identifier": [{ "value": "801fb16b57be8843" }],
  "gender": "female", "birthDate": "1985",
  "address": [{ "postalCode": "94000", "country": "FR" }] }
```

### Utilisation
```bash
python securehealth_cli.py valider donnees/lot-avec-erreurs.json
export SECUREHEALTH_CLE="une-longue-cle-secrete"   # jamais dans le dépôt
python securehealth_cli.py anonymiser donnees/lot-fictif.json anonyme.json
```
```
[erreur] Bundle.entry[1].Observation.code.coding[0].code : code LOINC « 8867-3 » invalide (chiffre de contrôle)
[erreur] Bundle.entry[3].Observation.subject : référence Patient/pat-999 introuvable dans le lot
...
k-anonymat (année de naissance, sexe, département) : k = 1
  → années par tranches de 10 ans
  → années par tranches de 20 ans
  → département supprimé
  → 13 patient(s) trop rares retirés
k-anonymat final : k = 8
```
Sur un petit lot de 40 patients, atteindre k = 5 coûte cher : il faut perdre le département et retirer un tiers des patients. C'est la vraie difficulté de l'anonymisation, et l'outil la montre au lieu de la cacher.

### Fichiers
| Fichier | Contenu |
|---|---|
| `securehealth/validation.py` | règles de validation FHIR, chiffre de contrôle LOINC |
| `securehealth/anonymisation.py` | pseudonymes HMAC, généralisation, décalage des dates, k-anonymat |
| `securehealth/exemples.py` | génération du lot fictif |
| `securehealth_cli.py` | validation et anonymisation en ligne de commande |
| `donnees/` | lot fictif valide et lot avec 6 erreurs volontaires |
| `tests/test_securehealth.py` | 184 vérifications : `python tests/test_securehealth.py` |

Les tests vérifient notamment les vrais codes LOINC, que chaque type d'erreur injectée est repéré, qu'aucun nom, téléphone, adresse ou identifiant d'origine ne reste dans le lot anonymisé, que les références restent cohérentes, que les intervalles entre dates sont conservés, et que le lot anonymisé reste valide.

### Limites
- Validateur simplifié : pas de profils FHIR, ni de vérification complète des types et des cardinalités.
- La pseudonymisation n'est pas une anonymisation au sens du RGPD : avec la clé, on peut refaire le lien. La clé doit rester chez l'hôpital.
- Le k-anonymat ne protège pas contre tout, par exemple quand tous les patients d'un groupe ont le même diagnostic.

Aucune dépendance (bibliothèque standard Python). Projet écrit en 2026.

---

## English

**Validation and anonymisation of FHIR health data.** Validates Patient, Observation and Bundle resources (required fields, value sets, date formats with timezone, internal references, LOINC check digits, UCUM units). Anonymises by removing direct identifiers, replacing IDs with **HMAC-SHA256 pseudonyms** (consistent across the bundle), reducing birth dates to the year (90+ grouped), postal codes to the département, and **shifting all dates of a patient by the same offset** so intervals are preserved. Measures **k-anonymity** and generalises step by step, then suppresses records, until k is reached.

```bash
python securehealth_cli.py valider donnees/lot-avec-erreurs.json
SECUREHEALTH_CLE="long-secret-key" python securehealth_cli.py anonymiser donnees/lot-fictif.json out.json
python tests/test_securehealth.py   # 184 checks
```

**Fictitious** data. Pseudonymisation is not anonymisation under GDPR: the key must stay with the hospital. Standard library only. Written in 2026.
