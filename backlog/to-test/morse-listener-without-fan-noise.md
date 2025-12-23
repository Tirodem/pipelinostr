# Test: Morse Listener sans bruit de ventilateur

## Description
Tester le Morse Code Listener avec le microphone éloigné du ventilateur du Raspberry Pi pour valider la précision du décodage.

## Contexte
Le listener fonctionne mais le bruit du ventilateur à ~700Hz interfère avec la détection, causant :
- Des dots parasites (E, I, S, H détectés sans signal)
- Des dashes mal décodés (O → G, etc.)

## Test à effectuer
1. Éloigner le micro du Pi (câble extension USB ou jack)
2. Envoyer `morse: SOS` et `morse: OK`
3. Vérifier que le décodage est propre (`... --- ...` → `SOS`)
4. Vérifier que Telegram et Nostr DM reçoivent le message correct

## Résultat attendu
- Décodage précis sans parasites
- Pas de messages "dot-only" du ventilateur
- Workflow morse-received déclenché avec le bon texte

## Date d'ajout
2025-12-23
