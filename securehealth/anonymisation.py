"""Anonymisation (pseudonymisation) d'un Bundle FHIR avant partage pour la recherche.

Règles appliquées :
- identifiants directs supprimés : nom, téléphone, e-mail, adresse précise, photo, contact,
  texte libre (text, note) ;
- identifiants techniques remplacés par un pseudonyme HMAC-SHA256 avec une clé secrète :
  même patient = même pseudonyme dans tout le lot, mais impossible à retrouver sans la clé ;
- date de naissance réduite à l'année, et regroupée en « 90 ans et plus » au-delà de 89 ans ;
- code postal réduit au département (2 premiers chiffres) ;
- toutes les dates d'un même patient décalées du même nombre de jours (entre -180 et +180),
  tiré de la clé : les intervalles entre examens sont conservés.
Le risque de réidentification est mesuré par la k-anonymat sur les quasi-identifiants.
"""
import copy
import datetime as dt
import hashlib
import hmac
from collections import Counter

CHAMPS_DIRECTS = ("name", "telecom", "photo", "contact", "text")


def pseudonyme(cle, valeur, n=16):
    return hmac.new(cle, str(valeur).encode(), hashlib.sha256).hexdigest()[:n]


def decalage_jours(cle, id_patient):
    """Décalage déterministe entre -180 et +180 jours, propre à chaque patient."""
    h = int(pseudonyme(cle, "date:" + str(id_patient), 8), 16)
    return h % 361 - 180


def _decaler_date(valeur, jours):
    if "T" in valeur:  # date-heure ISO avec fuseau
        d = dt.datetime.fromisoformat(valeur.replace("Z", "+00:00"))
        sortie = (d + dt.timedelta(days=jours)).isoformat()
        return sortie.replace("+00:00", "Z") if valeur.endswith("Z") else sortie
    if len(valeur) == 10:
        return (dt.date.fromisoformat(valeur) + dt.timedelta(days=jours)).isoformat()
    return valeur  # année seule ou année-mois : trop imprécis pour être décalé


def anonymiser(bundle, cle, annee_reference=2026):
    """Renvoie (bundle anonymisé, rapport). Le bundle d'origine n'est pas modifié."""
    if isinstance(cle, str):
        cle = cle.encode()
    b = copy.deepcopy(bundle)
    entrees = [e["resource"] for e in b.get("entry", [])]
    rapport = Counter()
    decalages = {}
    for r in entrees:
        if r.get("resourceType") == "Patient":
            decalages[r["id"]] = decalage_jours(cle, r["id"])
    for e in b.get("entry", []):
        e.pop("fullUrl", None)
        r = e["resource"]
        for champ in CHAMPS_DIRECTS:
            if r.pop(champ, None) is not None:
                rapport[f"{champ} supprimé"] += 1
        if r["resourceType"] == "Patient":
            jours = decalages[r["id"]]
            for ident in r.get("identifier", []):
                ident["value"] = pseudonyme(cle, ident.get("system", "") + "|" + str(ident.get("value")))
                rapport["identifiant pseudonymisé"] += 1
            if "birthDate" in r:
                annee = int(r["birthDate"][:4])
                r["birthDate"] = str(annee) if annee_reference - annee <= 89 else str(annee_reference - 90)
                if annee_reference - annee > 89:
                    r["extension"] = [{"url": "urn:securehealth:age", "valueString": "90 ans et plus"}]
                rapport["date de naissance réduite à l'année"] += 1
            adresses = []
            for a in r.get("address", []):
                cp = str(a.get("postalCode", ""))
                if len(cp) >= 2:
                    adresses.append({"postalCode": cp[:2] + "000", "country": a.get("country", "FR")})
            if "address" in r:
                r["address"] = adresses
                rapport["adresse réduite au département"] += 1
            if "deceasedDateTime" in r:
                r["deceasedDateTime"] = _decaler_date(r["deceasedDateTime"], jours)
            r["id"] = pseudonyme(cle, "Patient/" + r["id"])
        elif r["resourceType"] == "Observation":
            ref = r.get("subject", {}).get("reference", "")
            ancien = ref.split("/", 1)[1] if "/" in ref else None
            jours = decalages.get(ancien, 0)
            if ancien is not None:
                r["subject"] = {"reference": "Patient/" + pseudonyme(cle, "Patient/" + ancien)}
            r.pop("note", None)
            r.pop("performer", None)
            if "effectiveDateTime" in r:
                r["effectiveDateTime"] = _decaler_date(r["effectiveDateTime"], jours)
                rapport["date décalée"] += 1
            r["id"] = pseudonyme(cle, "Observation/" + r["id"])
    return b, dict(rapport)


def quasi_identifiants(patient):
    cp = (patient.get("address") or [{}])[0].get("postalCode", "?")
    return (patient.get("birthDate", "?")[:4], patient.get("gender", "?"), str(cp)[:2])


def k_anonymat(bundle):
    """Taille du plus petit groupe de patients partageant les mêmes quasi-identifiants
    (année de naissance, sexe, département). k = 1 : quelqu'un est seul dans son groupe."""
    groupes = Counter(quasi_identifiants(e["resource"]) for e in bundle.get("entry", [])
                      if e["resource"].get("resourceType") == "Patient")
    return (min(groupes.values()) if groupes else 0), groupes


def generaliser_annees(bundle, pas=5):
    """Regroupe les années de naissance par tranches de `pas` ans pour augmenter k."""
    b = copy.deepcopy(bundle)
    for e in b.get("entry", []):
        r = e["resource"]
        if r.get("resourceType") == "Patient" and r.get("birthDate", "").isdigit():
            a = int(r["birthDate"])
            r["birthDate"] = str(a - a % pas)
            r["extension"] = [x for x in r.get("extension", []) if x["url"] != "urn:securehealth:tranche"]
            r["extension"].append({"url": "urn:securehealth:tranche", "valueString": f"{a - a % pas}-{a - a % pas + pas - 1}"})
    return b


def retirer_departement(bundle):
    b = copy.deepcopy(bundle)
    for e in b.get("entry", []):
        if e["resource"].get("resourceType") == "Patient":
            e["resource"].pop("address", None)
    return b


def atteindre_k(bundle, k_cible=5):
    """Généralise pas à pas jusqu'à k >= k_cible, puis supprime les patients restés trop rares.

    Étapes : années par 10 ans, par 20 ans, suppression du département, puis retrait des
    patients (et de leurs observations) dont le groupe compte moins de k_cible personnes.
    Renvoie (bundle, liste des étapes appliquées, k final, nombre de patients retirés).
    """
    etapes = []
    b = bundle
    for nom, f in (("années par tranches de 10 ans", lambda x: generaliser_annees(x, 10)),
                   ("années par tranches de 20 ans", lambda x: generaliser_annees(x, 20)),
                   ("département supprimé", retirer_departement)):
        if k_anonymat(b)[0] >= k_cible:
            break
        b = f(b)
        etapes.append(nom)
    k, groupes = k_anonymat(b)
    retires = 0
    if k < k_cible:
        rares = {g for g, n in groupes.items() if n < k_cible}
        ids = {e["resource"]["id"] for e in b["entry"] if e["resource"].get("resourceType") == "Patient"
               and quasi_identifiants(e["resource"]) in rares}
        retires = len(ids)
        b = copy.deepcopy(b)
        b["entry"] = [e for e in b["entry"] if e["resource"].get("id") not in ids
                      and e["resource"].get("subject", {}).get("reference", "").split("/")[-1] not in ids]
        etapes.append(f"{retires} patient(s) trop rares retirés")
        k = k_anonymat(b)[0]
    return b, etapes, k, retires
