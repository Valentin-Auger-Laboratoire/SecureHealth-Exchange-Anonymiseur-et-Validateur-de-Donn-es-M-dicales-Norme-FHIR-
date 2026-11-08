"""Valide puis anonymise un Bundle FHIR.

Usage :
  python securehealth_cli.py valider donnees/lot-fictif.json
  python securehealth_cli.py anonymiser donnees/lot-fictif.json sortie.json
La clé secrète est lue dans la variable d'environnement SECUREHEALTH_CLE (à garder hors du
dépôt) ; sans clé, une clé de démonstration est utilisée et un avertissement s'affiche.
"""
import json
import os
import sys

from securehealth import valider, erreurs, anonymiser, k_anonymat, atteindre_k


def afficher(problemes, titre):
    e = erreurs(problemes)
    print(f"{titre} : {len(e)} erreur(s), {len(problemes) - len(e)} avertissement(s)")
    for p in problemes[:10]:
        print(f"  [{p['gravite']}] {p['chemin']} : {p['message']}")
    if len(problemes) > 10:
        print(f"  … et {len(problemes) - 10} autre(s)")


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("valider", "anonymiser"):
        print(__doc__)
        sys.exit(1)
    with open(sys.argv[2], encoding="utf-8") as f:
        bundle = json.load(f)
    afficher(valider(bundle), "Validation")
    if sys.argv[1] == "valider":
        return
    if erreurs(valider(bundle)):
        print("Lot invalide : anonymisation refusée.")
        sys.exit(2)
    cle = os.environ.get("SECUREHEALTH_CLE")
    if not cle:
        print("⚠ Pas de clé SECUREHEALTH_CLE : clé de démonstration utilisée (ne pas faire en vrai).")
        cle = "cle-de-demonstration"
    anonyme, rapport = anonymiser(bundle, cle)
    for k, v in rapport.items():
        print(f"  {k} : {v}")
    k, _ = k_anonymat(anonyme)
    print(f"k-anonymat (année de naissance, sexe, département) : k = {k}")
    anonyme, etapes, k, _ = atteindre_k(anonyme, 5)
    for e in etapes:
        print(f"  → {e}")
    print(f"k-anonymat final : k = {k} (chaque patient est confondu avec au moins {k - 1} autres)")
    afficher(valider(anonyme), "Validation après anonymisation")
    sortie = sys.argv[3] if len(sys.argv) > 3 else "anonyme.json"
    with open(sortie, "w", encoding="utf-8") as f:
        json.dump(anonyme, f, ensure_ascii=False, indent=1)
    print(f"Écrit : {sortie}")


if __name__ == "__main__":
    main()
