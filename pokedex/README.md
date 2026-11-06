# Mein Pokédex 🎤

Ein sprechender Pokédex für Kinder (ab ca. 4 Jahren). Alles funktioniert per Sprache:
Knopf drücken, Frage stellen, der Pokédex zeigt das Pokémon und liest die Antwort vor.

## Was man fragen kann

| Frage (Beispiel) | Antwort |
|---|---|
| „Pikachu“ / „Wer ist Glurak?“ | Pokédex-Eintrag: Name, Art, Typ, Beschreibung |
| „Erzähl mehr“ | weiterer Pokédex-Text zum letzten Pokémon |
| „Wie groß ist Relaxo?“ | Größe + kindgerechter Vergleich („so groß wie eine Tür“) |
| „Wie schwer ist Onix?“ | Gewicht + Vergleich („so schwer wie ein Auto“) |
| „Was ist stark gegen Glurak?“ | Schwächen (Typen) |
| „In was entwickelt sich Evoli?“ | Entwicklungen |
| „Ist Glurak stärker als Turtok?“ | Kampf-Vergleich |
| „Wie klingt Pikachu?“ | spielt den Pokémon-Ruf ab |
| „Was für ein Typ ist Gengar?“, „Wo wohnt Karpador?“, „Welche Farbe hat …“ | |
| „Speichere Glumanda“ | kommt in die Sammlung ⭐ |
| „Wie groß ist es?“ | Fragen ohne Namen beziehen sich auf das zuletzt gezeigte Pokémon |

Kinder-Aussprache wird toleriert („Pikatschu“, „Glumander“, „Schigi“ …).

**Unten:** 🎤 Fragen · 📖 alle Pokémon zum Antippen · ❓ Quiz „Wer ist das Pokémon?“ · ⭐ Sammlung
**Eltern:** kleines ⚙︎ oben rechts (Stimme, Quiz-Schwierigkeit, Größe des Kindes).

## Technik

- Reine Web-App (HTML/CSS/JS), keine Server, kein API-Schlüssel, keine Kosten.
- Spracherkennung & Vorlesen: Web Speech API des Browsers (Chrome auf Android, Safari auf iPhone/iPad).
  Hinweis: Die Spracherkennung läuft je nach Gerät über Google bzw. Apple.
- Daten: `data/pokedex-de.json`, erzeugt aus den CSV-Daten der [PokéAPI](https://github.com/PokeAPI/pokeapi)
  mit `tools/build_data.py`. Bilder und Rufe werden von den PokéAPI-GitHub-Repos geladen.
- Offline-fähig nach dem ersten Laden (Service Worker).

## Online stellen (nötig für Handy/Tablet)

Mikrofon funktioniert nur über **https**. Einfachste Wege:

1. **GitHub Pages:** Repository → Settings → Pages → Branch wählen, Ordner `/ (root)` →
   App ist dann unter `https://<name>.github.io/<repo>/pokedex/` erreichbar.
2. **Netlify Drop:** den Ordner `pokedex` auf https://app.netlify.com/drop ziehen.

Dann auf dem Gerät öffnen und **„Zum Home-Bildschirm“** wählen → sieht aus wie eine App.

Lokal testen: `cd pokedex && python3 -m http.server 8000` → http://localhost:8000

## Daten neu erzeugen

```bash
# CSVs aus https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv in einen Ordner laden, dann:
python3 tools/build_data.py <csv-ordner> data/pokedex-de.json
```

---
Private Fan-App, nicht offiziell und nicht zur Veröffentlichung/zum Verkauf gedacht.
Pokémon © Nintendo / Creatures Inc. / GAME FREAK inc.
