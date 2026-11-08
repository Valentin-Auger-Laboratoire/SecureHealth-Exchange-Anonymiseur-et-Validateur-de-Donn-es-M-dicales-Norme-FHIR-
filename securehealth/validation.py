"""Validation simplifiée de ressources FHIR R4 (Patient, Observation, Bundle).

Ce n'est pas un validateur complet de la norme : il vérifie les règles qui posent le plus
souvent problème lors d'un échange (champs obligatoires, valeurs autorisées, formats de
dates, références, codes LOINC, unités). Le résultat imite un OperationOutcome.
"""
import re

GENRES = {"male", "female", "other", "unknown"}
STATUTS_OBS = {"registered", "preliminary", "final", "amended", "corrected", "cancelled",
               "entered-in-error", "unknown"}
LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
RE_DATE = re.compile(r"^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$")
RE_DATETIME = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$")
RE_ID = re.compile(r"^[A-Za-z0-9\-.]{1,64}$")
RE_LOINC = re.compile(r"^(\d{1,7})-(\d)$")


def chiffre_controle_loinc(partie):
    """Chiffre de contrôle LOINC (algorithme modulo 10 de type Luhn)."""
    total = 0
    for i, c in enumerate(reversed(partie)):
        d = int(c)
        if i % 2 == 0:
            d *= 2
            d = d - 9 if d > 9 else d
        total += d
    return (10 - total % 10) % 10


def loinc_valide(code):
    m = RE_LOINC.match(code or "")
    return bool(m) and chiffre_controle_loinc(m.group(1)) == int(m.group(2))


def _probleme(liste, gravite, chemin, texte):
    liste.append({"gravite": gravite, "chemin": chemin, "message": texte})


def valider_patient(p, chemin="Patient"):
    pb = []
    if not RE_ID.match(str(p.get("id", ""))):
        _probleme(pb, "erreur", chemin + ".id", "identifiant absent ou mal formé")
    if "gender" in p and p["gender"] not in GENRES:
        _probleme(pb, "erreur", chemin + ".gender", f"valeur « {p['gender']} » hors du jeu autorisé")
    if "birthDate" in p and not RE_DATE.match(str(p["birthDate"])):
        _probleme(pb, "erreur", chemin + ".birthDate", "date attendue au format AAAA, AAAA-MM ou AAAA-MM-JJ")
    for i, ident in enumerate(p.get("identifier", [])):
        if not str(ident.get("system", "")).startswith(("http://", "https://", "urn:")):
            _probleme(pb, "avertissement", f"{chemin}.identifier[{i}].system", "système d'identifiant non qualifié (URI attendue)")
    return pb


def valider_observation(o, chemin="Observation", patients=None):
    pb = []
    if not RE_ID.match(str(o.get("id", ""))):
        _probleme(pb, "erreur", chemin + ".id", "identifiant absent ou mal formé")
    if o.get("status") not in STATUTS_OBS:
        _probleme(pb, "erreur", chemin + ".status", "statut obligatoire, valeur hors du jeu autorisé")
    codings = o.get("code", {}).get("coding", [])
    if not codings:
        _probleme(pb, "erreur", chemin + ".code", "code obligatoire")
    for i, c in enumerate(codings):
        if c.get("system") == LOINC and not loinc_valide(c.get("code")):
            _probleme(pb, "erreur", f"{chemin}.code.coding[{i}].code", f"code LOINC « {c.get('code')} » invalide (chiffre de contrôle)")
    ref = o.get("subject", {}).get("reference", "")
    if not re.match(r"^Patient/[A-Za-z0-9\-.]{1,64}$", ref):
        _probleme(pb, "erreur", chemin + ".subject", "référence au patient attendue (Patient/id)")
    elif patients is not None and ref.split("/")[1] not in patients:
        _probleme(pb, "erreur", chemin + ".subject", f"référence {ref} introuvable dans le lot")
    eff = o.get("effectiveDateTime")
    if eff is not None and not RE_DATETIME.match(str(eff)):
        _probleme(pb, "erreur", chemin + ".effectiveDateTime", "date-heure avec fuseau horaire attendue")
    q = o.get("valueQuantity")
    if q is not None:
        if not isinstance(q.get("value"), (int, float)) or isinstance(q.get("value"), bool):
            _probleme(pb, "erreur", chemin + ".valueQuantity.value", "valeur numérique attendue")
        if q.get("system") != UCUM or not q.get("code"):
            _probleme(pb, "avertissement", chemin + ".valueQuantity", "unité non codée en UCUM")
    return pb


def valider(ressource):
    """Valide une ressource ou un Bundle. Renvoie la liste des problèmes."""
    t = ressource.get("resourceType")
    if t == "Patient":
        return valider_patient(ressource)
    if t == "Observation":
        return valider_observation(ressource)
    if t != "Bundle":
        return [{"gravite": "erreur", "chemin": "resourceType", "message": f"type « {t} » non pris en charge"}]
    pb = []
    entrees = [e.get("resource", {}) for e in ressource.get("entry", [])]
    patients = {r.get("id") for r in entrees if r.get("resourceType") == "Patient"}
    for i, r in enumerate(entrees):
        ch = f"Bundle.entry[{i}].{r.get('resourceType')}"
        if r.get("resourceType") == "Patient":
            pb += valider_patient(r, ch)
        elif r.get("resourceType") == "Observation":
            pb += valider_observation(r, ch, patients)
        else:
            _probleme(pb, "erreur", ch, "type de ressource non pris en charge")
    return pb


def erreurs(problemes):
    return [p for p in problemes if p["gravite"] == "erreur"]
