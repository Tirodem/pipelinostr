# Balance Query Commands

**Date:** 2025-12-20
**Status:** Proposed
**Priority:** Medium

## Description

Commandes DM pour consulter les soldes SATs stockes dans workflow_db.

## Commandes proposees

### 1. `/balance`
Consulter son propre solde.

**Usage:** `/balance`
**Reponse:** "Votre solde: 1234 SATs"

### 2. `/howmuchdidIzap <target_npub>`
Consulter combien on a zappe vers un npub cible.

**Usage:** `/howmuchdidIzap npub1xyz...`
**Reponse:** "Vous avez zappe 5000 SATs vers npub1xyz..."

### 3. `/topzappers` (optionnel)
Liste des plus gros zappeurs (pour l'admin).

## Implementation

- Workflow `balance-check.yml` pour `/balance`
- Workflow `zap-history-check.yml` pour `/howmuchdidIzap`
- Utilise `workflow_db` action `get` et `list`

## Dependances

- Handler `workflow_db` (deja implemente)
- Workflows ClaudeDM (pour le modele de balance tracking)

## Notes

Ces commandes sont utiles pour :
- Permettre aux utilisateurs de verifier leur solde avant d'utiliser ClaudeDM
- Transparence sur les zaps effectues
- Debug et support utilisateur
