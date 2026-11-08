"""Génération d'un lot FHIR fictif (patients et observations) pour les essais.

Noms inventés, téléphones dans la plage 01 99 00 xx xx réservée à la fiction,
adresses e-mail en exemple.fr : aucune donnée réelle.
"""
import random

PRENOMS = ["Camille", "Louis", "Inès", "Hugo", "Léa", "Nathan", "Chloé", "Adam", "Manon", "Jules"]
NOMS = ["Martin", "Bernard", "Durand", "Petit", "Moreau", "Laurent", "Simon", "Michel", "Garnier", "Faure"]
VILLES = [("91000", "Évry-Courcouronnes"), ("91100", "Corbeil-Essonnes"), ("75013", "Paris"),
          ("94000", "Créteil"), ("92100", "Boulogne-Billancourt")]
MESURES = [("8867-4", "Fréquence cardiaque", "/min", 60, 100),
           ("59408-5", "SpO2", "%", 93, 99),
           ("8310-5", "Température corporelle", "Cel", 36.2, 38.4),
           ("2339-0", "Glucose sanguin", "mg/dL", 70, 160)]


def lot(n_patients=40, graine=0):
    rng = random.Random(graine)
    entrees = []
    for i in range(n_patients):
        pid = f"pat-{i + 1:03d}"
        cp, ville = rng.choice(VILLES)
        annee = rng.randint(1932, 2004)
        entrees.append({"fullUrl": f"urn:uuid:{pid}", "resource": {
            "resourceType": "Patient", "id": pid,
            "identifier": [{"system": "https://hopital-demo.example/ipp", "value": f"IPP{100000 + i}"}],
            "name": [{"family": rng.choice(NOMS), "given": [rng.choice(PRENOMS)]}],
            "telecom": [{"system": "phone", "value": f"01 99 00 {i // 100:02d} {i % 100:02d}"},
                        {"system": "email", "value": f"patient{i + 1}@exemple.fr"}],
            "gender": rng.choice(["male", "female"]),
            "birthDate": f"{annee}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
            "address": [{"line": [f"{rng.randint(1, 120)} rue de la Démo"], "city": ville, "postalCode": cp, "country": "FR"}],
            "text": {"status": "generated", "div": "<div>Patient fictif</div>"},
        }})
        for k in range(3):
            code, libelle, unite, lo, hi = rng.choice(MESURES)
            jour = rng.randint(1, 28)
            entrees.append({"fullUrl": f"urn:uuid:{pid}-obs{k}", "resource": {
                "resourceType": "Observation", "id": f"{pid}-obs{k}", "status": "final",
                "code": {"coding": [{"system": "http://loinc.org", "code": code, "display": libelle}]},
                "subject": {"reference": f"Patient/{pid}"},
                "effectiveDateTime": f"2026-03-{jour:02d}T{rng.randint(7, 19):02d}:{rng.choice(['00', '15', '30', '45'])}:00+01:00",
                "valueQuantity": {"value": round(rng.uniform(lo, hi), 1), "unit": unite,
                                  "system": "http://unitsofmeasure.org", "code": unite},
                "note": [{"text": f"Mesure prise par l'infirmière de garde pour {pid}"}],
            }})
    return {"resourceType": "Bundle", "type": "collection", "entry": entrees}
