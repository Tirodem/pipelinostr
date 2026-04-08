# PipeliNostr CLI

Script de gestion en ligne de commande pour PipeliNostr.

```bash
./scripts/pipelinostr.sh <command> [options]
```

## Workflows

### Lister les workflows

```bash
# Tous les workflows
./scripts/pipelinostr.sh workflow list

# Seulement les actifs
./scripts/pipelinostr.sh workflow list enabled

# Seulement les désactivés
./scripts/pipelinostr.sh workflow list disabled
```

### Activer des workflows

```bash
# Un seul workflow
./scripts/pipelinostr.sh workflow enable zulip-forward

# Plusieurs workflows (séparés par virgule)
./scripts/pipelinostr.sh workflow enable zulip-forward,zap-notification,dpo-command

# Tous les workflows
./scripts/pipelinostr.sh workflow enable all

# Avec --force : active aussi les handlers requis
./scripts/pipelinostr.sh workflow enable --force nostr-to-telegram
./scripts/pipelinostr.sh workflow enable -f dm-to-mastodon,dm-to-bluesky
```

### Désactiver des workflows

```bash
# Un seul workflow
./scripts/pipelinostr.sh workflow disable zulip-forward

# Plusieurs workflows
./scripts/pipelinostr.sh workflow disable wf1,wf2,wf3

# Tous les workflows
./scripts/pipelinostr.sh workflow disable all
```

### Afficher un workflow

```bash
./scripts/pipelinostr.sh workflow show zulip-forward
```

### Rafraîchir depuis l'exemple

Supprime le workflow déployé et le remplace par la version exemple :

```bash
# Un workflow
./scripts/pipelinostr.sh workflow refresh pipelinostr-status

# Plusieurs workflows
./scripts/pipelinostr.sh workflow refresh pipelinostr-status,zulip-forward
```

Cherche les fichiers dans `examples/workflows/` avec les extensions :
- `{id}.yml.example`
- `{id}.yaml.example`
- `{id}.yml`
- `{id}.yaml`

### Déployer les workflows manquants

Déploie tous les workflows exemples qui ne sont pas encore dans `config/workflows/`.
Les workflows sont **désactivés par défaut** pour éviter les effets de bord.

```bash
# Déployer les exemples manquants (désactivés)
./scripts/pipelinostr.sh workflow load-missing

# Puis activer ceux voulus
./scripts/pipelinostr.sh workflow enable zulip-forward,zap-notification
```

### Nettoyer les workflows orphelins

Archive les workflows déployés qui n'ont plus de fichier exemple correspondant.

```bash
# Renommer en .old les workflows sans exemple
./scripts/pipelinostr.sh workflow clean

# Renommer ET supprimer les .old
./scripts/pipelinostr.sh workflow clean --purge
```

## Handlers

### Lister les handlers

```bash
# Tous les handlers
./scripts/pipelinostr.sh handler list

# Seulement les actifs
./scripts/pipelinostr.sh handler list enabled

# Seulement les désactivés
./scripts/pipelinostr.sh handler list disabled
```

### Activer des handlers

```bash
# Un seul handler
./scripts/pipelinostr.sh handler enable email

# Plusieurs handlers
./scripts/pipelinostr.sh handler enable telegram,email,zulip

# Tous les handlers
./scripts/pipelinostr.sh handler enable all
```

### Désactiver des handlers

```bash
# Un seul handler
./scripts/pipelinostr.sh handler disable traccar-sms

# Plusieurs handlers
./scripts/pipelinostr.sh handler disable discord,twitter,matrix

# Tous les handlers
./scripts/pipelinostr.sh handler disable all
```

### Afficher un handler

```bash
./scripts/pipelinostr.sh handler show telegram
```

### Rafraîchir depuis l'exemple

Supprime le handler déployé et le remplace par la version exemple :

```bash
# Un handler
./scripts/pipelinostr.sh handler refresh telegram

# Plusieurs handlers
./scripts/pipelinostr.sh handler refresh telegram,email,zulip
```

Cherche les fichiers dans `config/handlers/` avec l'extension `.yml.example`.

### Déployer les handlers manquants

Déploie tous les handlers exemples qui ne sont pas encore déployés.
Les handlers sont **désactivés par défaut** pour éviter les erreurs de connexion.

```bash
# Déployer les exemples manquants (désactivés)
./scripts/pipelinostr.sh handler load-missing

# Puis activer ceux voulus
./scripts/pipelinostr.sh handler enable telegram,email
```

### Nettoyer les handlers orphelins

Archive les handlers déployés qui n'ont plus de fichier exemple correspondant.

```bash
# Renommer en .old les handlers sans exemple
./scripts/pipelinostr.sh handler clean

# Renommer ET supprimer les .old
./scripts/pipelinostr.sh handler clean --purge
```

## Relays

### Lister les relays

```bash
./scripts/pipelinostr.sh relay list
```

Affiche tous les relays de la base de données avec leur statut (active, quarantined, abandoned).

### Ajouter un relay

```bash
./scripts/pipelinostr.sh relay add wss://relay.example.com
```

### Supprimer un relay

```bash
./scripts/pipelinostr.sh relay remove wss://relay.example.com
```

### Gérer la blacklist

```bash
# Afficher la blacklist actuelle
./scripts/pipelinostr.sh relay blacklist

# Ajouter à la blacklist
./scripts/pipelinostr.sh relay blacklist +wss://spam.relay.com

# Retirer de la blacklist
./scripts/pipelinostr.sh relay blacklist -wss://spam.relay.com
```

## Service

### Statut

```bash
./scripts/pipelinostr.sh status
```

Affiche :
- État du service (Running/Stopped + PID)
- Nombre de workflows actifs/total
- Nombre de handlers actifs/total
- Taille du fichier de log

### Redémarrer

```bash
./scripts/pipelinostr.sh restart
```

### Logs

```bash
# 50 dernières lignes (défaut)
./scripts/pipelinostr.sh logs

# N dernières lignes
./scripts/pipelinostr.sh logs 100
```

## Exemples d'utilisation

### Déployer un nouveau workflow

```bash
# Copier l'exemple
./scripts/pipelinostr.sh workflow refresh pipelinostr-status

# Activer avec les handlers requis
./scripts/pipelinostr.sh workflow enable --force pipelinostr-status

# Redémarrer
./scripts/pipelinostr.sh restart
```

### Désactiver tout sauf quelques workflows

```bash
# Désactiver tout
./scripts/pipelinostr.sh workflow disable all

# Réactiver seulement ceux voulus
./scripts/pipelinostr.sh workflow enable zulip-forward,zap-notification

# Redémarrer
./scripts/pipelinostr.sh restart
```

### Mettre à jour les workflows après un git pull

```bash
git pull

# Rafraîchir les workflows modifiés
./scripts/pipelinostr.sh workflow refresh pipelinostr-status,zulip-forward

# Rebuild et restart
./scripts/rebuild.sh
```

## Notes

- Toutes les modifications nécessitent un redémarrage pour prendre effet
- Les IDs multiples sont séparés par des virgules **sans espaces**
- Le flag `--force` ou `-f` peut être placé avant ou après l'ID
- Les handlers "built-in" (nostr_dm, http, system, etc.) n'ont pas de fichier de config
