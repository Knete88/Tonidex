#!/usr/bin/env python3
"""Baut data/pokedex-de.json aus den CSV-Dateien der PokeAPI
(https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv).

Aufruf: python3 build_data.py <csv-ordner> <ausgabe.json>
"""
import csv, json, sys, os, re
from collections import defaultdict

src, out = sys.argv[1], sys.argv[2]
DE, EN = "6", "9"

def rows(name):
    with open(os.path.join(src, name + ".csv"), encoding="utf-8") as f:
        return list(csv.DictReader(f))

species = rows("pokemon_species")
names_de, genus_de, names_en = {}, {}, {}
for r in rows("pokemon_species_names"):
    if r["local_language_id"] == DE:
        names_de[r["pokemon_species_id"]] = r["name"]
        genus_de[r["pokemon_species_id"]] = r["genus"]
    elif r["local_language_id"] == EN:
        names_en[r["pokemon_species_id"]] = r["name"]

def clean(t):
    t = t.replace("­\n", "").replace("-\n", "-").replace("\f", " ").replace("\n", " ")
    return re.sub(r"\s+", " ", t).strip()

flavors = defaultdict(list)
for r in rows("pokemon_species_flavor_text"):
    if r["language_id"] == DE:
        t = clean(r["flavor_text"])
        if t not in flavors[r["species_id"]]:
            flavors[r["species_id"]].append(t)

# Standard-Pokemon (Form) pro Art
default_poke = {}
for r in rows("pokemon"):
    if r["is_default"] == "1":
        default_poke[r["species_id"]] = r
types_of = defaultdict(list)
for r in sorted(rows("pokemon_types"), key=lambda r: int(r["slot"])):
    types_of[r["pokemon_id"]].append(int(r["type_id"]))
stats_of = defaultdict(dict)
for r in rows("pokemon_stats"):
    stats_of[r["pokemon_id"]][int(r["stat_id"])] = int(r["base_stat"])

type_de = {int(r["type_id"]): r["name"] for r in rows("type_names") if r["local_language_id"] == DE and int(r["type_id"]) <= 18}
color_de = {r["pokemon_color_id"]: r["name"] for r in rows("pokemon_color_names") if r["local_language_id"] == DE}
habitat_de = {"1": "in Höhlen", "2": "im Wald", "3": "auf Wiesen", "4": "in den Bergen", "5": "an ganz seltenen, geheimen Orten",
              "6": "in rauem, felsigem Gelände", "7": "im Meer", "8": "in der Stadt", "9": "am Wasser"}
item_de = {r["item_id"]: r["name"] for r in rows("item_names") if r["local_language_id"] == DE}

# Typ-Effektivitaet: eff[angreifer][verteidiger] = Faktor
eff = defaultdict(dict)
for r in rows("type_efficacy"):
    a, d = int(r["damage_type_id"]), int(r["target_type_id"])
    if a <= 18 and d <= 18:
        eff[a][d] = int(r["damage_factor"]) / 100

evo_info = {}
for r in rows("pokemon_evolution"):
    sid = r["evolved_species_id"]
    if sid in evo_info:
        continue
    if r["minimum_level"]:
        how = f"ab Level {r['minimum_level']}"
    elif r["trigger_item_id"]:
        how = f"mit dem Gegenstand {item_de.get(r['trigger_item_id'], 'besonderer Stein')}"
    elif r["evolution_trigger_id"] == "2":
        how = "durch Tauschen"
    elif r["minimum_happiness"]:
        how = "wenn es seinen Trainer ganz doll lieb hat"
    else:
        how = "auf eine ganz besondere Art"
    evo_info[sid] = how

out_list = []
for s in species:
    sid = s["id"]
    p = default_poke.get(sid)
    if not p or sid not in names_de:
        continue
    st = stats_of[p["id"]]
    fl = sorted(flavors.get(sid, []), key=len)[:3]
    out_list.append({
        "id": int(sid),
        "n": names_de[sid],
        "en": names_en.get(sid, ""),
        "g": genus_de.get(sid, ""),
        "t": types_of[p["id"]],
        "h": int(p["height"]),   # Dezimeter
        "w": int(p["weight"]),   # Hektogramm
        "c": color_de.get(s["color_id"], ""),
        "hab": habitat_de.get(s["habitat_id"], ""),
        "gen": int(s["generation_id"]),
        "from": int(s["evolves_from_species_id"]) if s["evolves_from_species_id"] else 0,
        "how": evo_info.get(sid, ""),
        "chain": int(s["evolution_chain_id"]),
        "leg": 1 if s["is_legendary"] == "1" else (2 if s["is_mythical"] == "1" else 0),
        "baby": 1 if s["is_baby"] == "1" else 0,
        "st": [st.get(i, 0) for i in range(1, 7)],
        "f": fl,
    })
out_list.sort(key=lambda x: x["id"])

data = {
    "types": {k: v for k, v in sorted(type_de.items())},
    "eff": {a: {d: f for d, f in row.items() if f != 1} for a, row in eff.items()},
    "pokemon": out_list,
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
print(len(out_list), "Pokémon,", os.path.getsize(out) // 1024, "KB")
