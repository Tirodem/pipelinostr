---
title: "Braille Text Converter Workflow"
priority: "Low"
status: "Proposed"
created: "2025-12-20"
---

### Braille Text Converter Workflow

**Priority:** Low
**Status:** Proposed

#### Description

Créer un workflow qui convertit le texte d'un DM en représentation Braille Unicode et le renvoie en DM.

#### Use Case

```
User: braille: Hello World

PipeliNostr: Braille: "Hello World"

⠓⠑⠇⠇⠕ ⠺⠕⠗⠇⠙
```

#### Implémentation

- Créer un helper Handlebars `{{ braille text }}` ou une action dédiée
- Utiliser les caractères Unicode Braille (U+2800 à U+28FF)
- Support du Braille Grade 1 (lettre par lettre) en priorité
- Optionnel : Braille Grade 2 (contractions) plus tard

#### Table de conversion (Grade 1)

```
A ⠁  B ⠃  C ⠉  D ⠙  E ⠑  F ⠋  G ⠛  H ⠓  I ⠊  J ⠚
K ⠅  L ⠇  M ⠍  N ⠝  O ⠕  P ⠏  Q ⠟  R ⠗  S ⠎  T ⠞
U ⠥  V ⠧  W ⠺  X ⠭  Y ⠽  Z ⠵
0 ⠴  1 ⠂  2 ⠆  3 ⠒  4 ⠲  5 ⠢  6 ⠖  7 ⠶  8 ⠦  9 ⠔
```

#### Workflow exemple

```yaml
id: nostr-to-braille
trigger:
  type: nostr_event
  filters:
    kinds: [4]
    content_pattern: "^braille:\\s*(?<text>.+)$"

actions:
  - type: nostr_dm
    config:
      to: "{{ trigger.from }}"
      content: |
        Braille: "{{ match.text }}"

        {{ braille match.text }}
```

#### Ressources

- [Unicode Braille Patterns](https://www.unicode.org/charts/PDF/U2800.pdf)
- [Braille ASCII](https://en.wikipedia.org/wiki/Braille_ASCII)

---


---
