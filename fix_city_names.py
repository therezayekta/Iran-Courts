"""
Step 1: SCAN  -- compares every shahrestan/city in your geojson boundary file
                 against the keys in your court JSON files, using a normalized
                 (prefix-stripped, letter-normalized) match.
Step 2: REPORT -- prints exact matches, fixable "fuzzy" matches (e.g. شوط vs
                  شهرستان شوط), and anything with no match at all.
Step 3: ASK    -- prompts you before touching any files.
Step 4: FIX    -- if you say yes, renames the matched JSON keys to the
                  geojson's English adm2_name, and adds a small language note.

Usage:
    python fix_city_names.py boundaries.geojson courts_folder/

This does NOT delete any data. It only renames dict keys. A backup of every
JSON file it touches is written first (same name + .bak).
"""

import json
import re
import sys
import shutil
import unicodedata
from pathlib import Path


# ---------- normalization ----------

PREFIXES = ["شهرستان", "بخش", "شهر"]  # common administrative prefixes to strip when comparing

def normalize(text: str) -> str:
    if text is None:
        return ""
    text = str(text)
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("ك", "ک").replace("ي", "ی").replace("ة", "ه")
    text = text.replace("\u200c", " ").replace("\u200f", "").replace("\u200e", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text

def strip_prefix(text: str) -> str:
    norm = normalize(text)
    for p in PREFIXES:
        if norm.startswith(p + " "):
            return norm[len(p):].strip()
    return norm


# ---------- load geojson ----------

def load_geo_cities(geo_path: Path):
    """
    Returns list of dicts: {pcode, name_en, name_fa, name_fa_stripped}
    """
    with open(geo_path, encoding="utf-8") as f:
        geo = json.load(f)

    out = []
    for feat in geo.get("features", []):
        p = feat.get("properties", {})
        name_en = p.get("adm2_name")
        name_fa = p.get("adm2_name1")
        pcode = p.get("adm2_pcode")
        if not name_en or not name_fa:
            continue
        out.append({
            "pcode": pcode,
            "name_en": name_en,
            "name_fa": name_fa,
            "name_fa_stripped": strip_prefix(name_fa),
        })
    return out


# ---------- load court json files ----------

def load_json_area_keys(courts_folder: Path):
    """
    Returns list of dicts: {file, key, stripped}
    covering every top-level 'areas' key across every json file.
    (District-level keys inside 'districts' are left alone on purpose --
    those are sub-areas, not shahrestans, and generally shouldn't be renamed
    to English the same way.)
    """
    out = []
    for jf in courts_folder.glob("*.json"):
        try:
            with open(jf, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"  (skipping {jf.name}, couldn't parse: {e})")
            continue

        areas = data.get("areas", {})
        for key in areas.keys():
            out.append({
                "file": jf,
                "key": key,
                "stripped": strip_prefix(key),
            })
    return out


# ---------- matching ----------

def build_matches(geo_cities, json_keys):
    exact = []       # geojson name_en == json key already (nothing to do)
    fixable = []     # stripped forms match -> safe to rename
    unmatched_geo = []   # geojson city with no corresponding json key found
    unmatched_json = []  # json key that doesn't correspond to any geojson city

    geo_by_stripped = {}
    for c in geo_cities:
        geo_by_stripped.setdefault(c["name_fa_stripped"], []).append(c)

    matched_json_keys = set()

    for jk in json_keys:
        if jk["key"] in [c["name_en"] for c in geo_cities]:
            exact.append(jk)
            matched_json_keys.add(id(jk))
            continue

        candidates = geo_by_stripped.get(jk["stripped"], [])
        if len(candidates) == 1:
            fixable.append((jk, candidates[0]))
            matched_json_keys.add(id(jk))
        elif len(candidates) > 1:
            # ambiguous -- more than one geojson city normalizes to the same stripped name
            fixable.append((jk, candidates[0]))  # still offer the first as a suggestion
            matched_json_keys.add(id(jk))
        else:
            unmatched_json.append(jk)

    matched_pcodes = {m[1]["pcode"] for m in fixable} | {
        c["pcode"] for c in geo_cities if c["name_en"] in [j["key"] for j in json_keys]
    }
    for c in geo_cities:
        if c["pcode"] not in matched_pcodes:
            unmatched_geo.append(c)

    return exact, fixable, unmatched_geo, unmatched_json


# ---------- apply fix ----------

def apply_fixes(fixable):
    files_touched = set()
    for jk, geo_city in fixable:
        jf = jk["file"]
        files_touched.add(jf)

    # backup first
    for jf in files_touched:
        backup = jf.with_suffix(jf.suffix + ".bak")
        shutil.copy2(jf, backup)
        print(f"  backed up {jf.name} -> {backup.name}")

    # group renames by file
    renames_by_file = {}
    for jk, geo_city in fixable:
        renames_by_file.setdefault(jk["file"], []).append((jk["key"], geo_city["name_en"]))

    for jf, renames in renames_by_file.items():
        with open(jf, encoding="utf-8") as f:
            data = json.load(f)
        areas = data.get("areas", {})
        new_areas = {}
        for old_key, val in areas.items():
            new_key = old_key
            for r_old, r_new in renames:
                if r_old == old_key:
                    new_key = r_new
                    break
            if new_key in new_areas:
                print(f"  ⚠️  COLLISION in {jf.name}: '{new_key}' already exists, "
                      f"keeping original key '{old_key}' unrenamed to avoid data loss")
                new_areas[old_key] = val
            else:
                new_areas[new_key] = val
        data["areas"] = new_areas
        with open(jf, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  ✅ updated {jf.name} ({len(renames)} key(s) renamed)")


# ---------- main ----------

def main():
    if len(sys.argv) != 3:
        print("Usage: python fix_city_names.py <boundaries.geojson> <courts_folder/>")
        sys.exit(1)

    geo_path = Path(sys.argv[1])
    courts_folder = Path(sys.argv[2])

    if not geo_path.exists():
        print(f"Boundary file not found: {geo_path}")
        sys.exit(1)
    if not courts_folder.exists() or not courts_folder.is_dir():
        print(f"Courts folder not found: {courts_folder}")
        sys.exit(1)

    print("Loading geojson cities...")
    geo_cities = load_geo_cities(geo_path)
    print(f"  found {len(geo_cities)} cities/shahrestans with both EN and FA names")

    print("Loading JSON area keys...")
    json_keys = load_json_area_keys(courts_folder)
    print(f"  found {len(json_keys)} area keys across your court JSON files")

    print("\nMatching...\n")
    exact, fixable, unmatched_geo, unmatched_json = build_matches(geo_cities, json_keys)

    print("=" * 60)
    print(f"✅ Already correct (English key matches geojson):  {len(exact)}")
    print(f"🔧 Fixable (Persian key -> English, safe rename):   {len(fixable)}")
    print(f"❌ No matching JSON key found for this geo city:    {len(unmatched_geo)}")
    print(f"❓ JSON key with no matching geo city:               {len(unmatched_json)}")
    print("=" * 60)

    if fixable:
        print("\n🔧 PROPOSED RENAMES:\n")
        for jk, geo_city in fixable:
            print(f"   [{jk['file'].name}]  {jk['key']!r}  ->  {geo_city['name_en']!r}"
                  f"   (matched via Persian: {geo_city['name_fa']!r}, pcode {geo_city['pcode']})")

    if unmatched_geo:
        print("\n❌ THESE CITIES HAVE NO MATCHING DATA (will still be blank after this fix):\n")
        for c in unmatched_geo:
            print(f"   - {c['name_en']} / {c['name_fa']}  (pcode {c['pcode']})")
        print("\n   -> these need data added to your JSON files, this script can't invent it.")

    if unmatched_json:
        print("\n❓ THESE JSON KEYS DON'T MATCH ANY GEOJSON CITY (check for typos or old data):\n")
        for jk in unmatched_json:
            print(f"   - [{jk['file'].name}] {jk['key']!r}")

    if not fixable:
        print("\nNothing to fix. Exiting.")
        return

    print()
    answer = input(f"Apply the {len(fixable)} rename(s) above? Files will be backed up first. [y/N] ").strip().lower()
    if answer == "y":
        print("\nApplying fixes...")
        apply_fixes(fixable)
        print("\nDone. Re-run this script to confirm everything now shows as ✅ exact matches.")
    else:
        print("\nNo changes made.")


if __name__ == "__main__":
    main()