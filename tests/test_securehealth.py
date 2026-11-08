"""Vérifications : python tests/test_securehealth.py"""
import copy
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from securehealth import (valider, erreurs, loinc_valide, chiffre_controle_loinc, anonymiser,
                          pseudonyme, decalage_jours, k_anonymat, atteindre_k, lot)

n_ok = 0


def ok(cond, msg):
    global n_ok
    if not cond:
        raise AssertionError(msg)
    n_ok += 1


# Codes LOINC réels : chiffre de contrôle
for code in ("8867-4", "59408-5", "8310-5", "2339-0", "718-7", "4548-4", "8480-6"):
    ok(loinc_valide(code), f"LOINC {code} valide")
for code in ("8867-3", "718-6", "abc-1", "8867", ""):
    ok(not loinc_valide(code), f"LOINC « {code} » refusé")

# Validation : le lot fictif est valide, chaque erreur injectée est repérée
b = lot(20, graine=4)
ok(erreurs(valider(b)) == [], "lot fictif valide")
mutations = [
    (lambda r: r.update(gender="homme"), "Patient", "gender"),
    (lambda r: r.update(birthDate="12/03/1990"), "Patient", "birthDate"),
    (lambda r: r.update(id="pat 1!"), "Patient", "id"),
    (lambda r: r["code"]["coding"][0].update(code="8867-3"), "Observation", "code"),
    (lambda r: r.update(effectiveDateTime="2026-03-12T14:30:00"), "Observation", "effectiveDateTime"),
    (lambda r: r.update(subject={"reference": "Patient/inconnu"}), "Observation", "subject"),
    (lambda r: r.update(subject={"reference": "pat-001"}), "Observation", "subject"),
    (lambda r: r.pop("status"), "Observation", "status"),
    (lambda r: r["valueQuantity"].update(value="72"), "Observation", "valueQuantity.value"),
]
for f, type_, champ in mutations:
    c = copy.deepcopy(b)
    r = next(e["resource"] for e in c["entry"] if e["resource"]["resourceType"] == type_)
    f(r)
    e = erreurs(valider(c))
    if champ == "id":  # un identifiant cassé rend aussi les références du patient introuvables
        ok(any(x["chemin"].endswith(".id") for x in e), f"erreur repérée sur {type_}.{champ}")
    else:
        ok(len(e) == 1 and champ in e[0]["chemin"], f"erreur repérée sur {type_}.{champ}")
ok(valider({"resourceType": "Medication"})[0]["gravite"] == "erreur", "type non pris en charge")

# Anonymisation
cle = b"cle-de-test-secrete"
anonyme, rapport = anonymiser(b, cle)
texte = json.dumps(anonyme, ensure_ascii=False)
for e in b["entry"]:
    r = e["resource"]
    if r["resourceType"] == "Patient":
        for valeur in (r["id"], r["identifier"][0]["value"], r["telecom"][0]["value"], r["telecom"][1]["value"],
                       r["address"][0]["line"][0], r["address"][0]["city"], r["birthDate"]):
            ok(valeur not in texte, f"« {valeur} » a disparu")
ok('"name"' not in texte and '"telecom"' not in texte and '"note"' not in texte and '"text"' not in texte,
   "noms, téléphones, notes et texte libre supprimés")
ok(b["entry"][0]["resource"]["name"], "le lot d'origine n'est pas modifié")
ok(erreurs(valider(anonyme)) == [], "le lot anonymisé reste valide (références cohérentes)")

# Références : chaque observation pointe vers le pseudonyme de son patient
ids = {e["resource"]["id"] for e in anonyme["entry"] if e["resource"]["resourceType"] == "Patient"}
ok(all(e["resource"]["subject"]["reference"].split("/")[1] in ids
       for e in anonyme["entry"] if e["resource"]["resourceType"] == "Observation"), "références cohérentes")

# Pseudonymes : stables avec la même clé, différents avec une autre clé
ok(anonymiser(b, cle)[0] == anonyme, "même clé : même résultat")
autre = anonymiser(b, b"autre-cle")[0]
ok({e["resource"]["id"] for e in autre["entry"]}.isdisjoint({e["resource"]["id"] for e in anonyme["entry"]}),
   "autre clé : pseudonymes différents")
ok(pseudonyme(cle, "x") != pseudonyme(cle, "y") and len(pseudonyme(cle, "x")) == 16, "pseudonyme HMAC")

# Dates : même décalage pour toutes les mesures d'un patient, intervalles conservés
for pid in ("pat-001", "pat-002", "pat-003"):
    j = decalage_jours(cle, pid)
    ok(-180 <= j <= 180, "décalage borné")
    avant = [dt.datetime.fromisoformat(e["resource"]["effectiveDateTime"]) for e in b["entry"]
             if e["resource"].get("subject", {}).get("reference") == f"Patient/{pid}"]
    cible = "Patient/" + pseudonyme(cle, "Patient/" + pid)
    apres = [dt.datetime.fromisoformat(e["resource"]["effectiveDateTime"]) for e in anonyme["entry"]
             if e["resource"].get("subject", {}).get("reference") == cible]
    ok(all((a2 - a1) == dt.timedelta(days=j) for a1, a2 in zip(avant, apres)), f"dates de {pid} décalées de {j} j")
    ok(all((avant[i + 1] - avant[i]) == (apres[i + 1] - apres[i]) for i in range(len(avant) - 1)), "intervalles conservés")

# Date de naissance et âge
p = {"resourceType": "Bundle", "entry": [{"resource": {"resourceType": "Patient", "id": "a", "birthDate": "1930-05-02", "gender": "female"}},
                                          {"resource": {"resourceType": "Patient", "id": "b", "birthDate": "1990-05-02", "gender": "male"}}]}
x = anonymiser(p, cle)[0]["entry"]
ok(x[0]["resource"]["birthDate"] == "1936" and x[0]["resource"]["extension"][0]["valueString"] == "90 ans et plus",
   "plus de 89 ans : regroupé en 90 ans et plus")
ok(x[1]["resource"]["birthDate"] == "1990", "naissance réduite à l'année")

# k-anonymat
groupe = lambda a, g, cp: {"resource": {"resourceType": "Patient", "id": f"{a}{g}{cp}{id(a)}", "birthDate": a, "gender": g, "address": [{"postalCode": cp}]}}
p = {"resourceType": "Bundle", "entry": [groupe("1980", "male", "91000")] * 3 + [groupe("1990", "female", "75000")]}
ok(k_anonymat(p)[0] == 1, "un patient seul dans son groupe : k = 1")
b2, etapes, k, retires = atteindre_k(anonymiser(lot(40), cle)[0], 5)
ok(k >= 5 and retires < 20, f"k ≥ 5 atteint ({k}) en retirant {retires} patients")
ok(erreurs(valider(b2)) == [], "lot final valide (observations des patients retirés retirées aussi)")

print(f"{n_ok} vérifications réussies")
