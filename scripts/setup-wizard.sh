#!/bin/bash
# PipeliNostr v2 — Setup Wizard (dialog-based)
# Called from install.sh or standalone for reconfiguration.

# No set -e — dialog returns non-zero on Back/Cancel which is normal flow

INSTALL_DIR="/opt/pipelinostr"
SERVICE_NAME="pipelinostr"
SERVICE_USER="pipelinostr"
REPO="https://github.com/Tirodem/the-ultra-secret-wip-side-project-we-dont-want-to-talk-about.git"
BRANCH="v2"
DIALOG_TITLE="PipeliNostr v2"
TMPFILE=$(mktemp)

# Use ASCII lines for terminal compatibility + show * for passwords + Back instead of Cancel
export DIALOGOPTS="--ascii-lines --insecure --cancel-label Back"
# Dark purple theme
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIALOGRC="$SCRIPT_DIR/dialogrc"

# Cleanup on exit: clear screen + remove temp file
trap "clear; rm -f $TMPFILE" EXIT

# --- Check dialog ---
if ! command -v dialog &>/dev/null; then
    echo "Installing dialog..."
    apt-get install -y -qq dialog 2>/dev/null || {
        echo "Error: dialog not found. Install it: apt install dialog"
        exit 1
    }
fi

# --- Must be root ---
if [ "$(id -u)" -ne 0 ]; then
    echo "Error: Run as root."
    exit 1
fi

# --- Git safe directory (root runs git on pipelinostr-owned repo) ---
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

# --- Detect existing installation ---
is_installed() {
    [ -f "$INSTALL_DIR/package.json" ]
}

# --- Helper: generate random string ---
gen_secret() {
    openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# --- Helper: check port in use ---
port_in_use() {
    ss -tlnp 2>/dev/null | grep -q ":$1 " && return 0 || return 1
}

# --- Helper: generate nostr keypair ---
gen_nostr_keys() {
    cd "$INSTALL_DIR"
    node -e "
import('nostr-tools').then(n => {
    const sk = n.generateSecretKey();
    console.log(n.nip19.nsecEncode(sk) + ' ' + n.nip19.npubEncode(n.getPublicKey(sk)));
});
" 2>/dev/null
}

# --- Helper: npub from nsec ---
npub_from_nsec() {
    local nsec="$1"
    cd "$INSTALL_DIR"
    node -e "
import('nostr-tools').then(n => {
    const decoded = n.nip19.decode('$nsec');
    if (decoded.type !== 'nsec') { console.error('Invalid nsec'); process.exit(1); }
    console.log(n.nip19.npubEncode(n.getPublicKey(decoded.data)));
});
" 2>/dev/null
}

# ============================================================
# FRESH INSTALL
# ============================================================

fresh_install() {

    # --- Step 1: Welcome ---
    dialog --title "$DIALOG_TITLE" --msgbox "\
Welcome to PipeliNostr!\n\n\
The n8n of Nostr — route Nostr events to external services.\n\n\
This wizard will guide you through:\n\
  1. Admin & bot account setup\n\
  2. Handler selection & configuration\n\
  3. Webhook API setup\n\
  4. Workflow selection\n\
  5. Service installation" 16 60

    # --- Step 2: Admin npub ---
    dialog --title "$DIALOG_TITLE — Admin" \
        --inputbox "Enter the admin npub (receives system notifications):" \
        10 70 2>"$TMPFILE"
    ADMIN_NPUB=$(cat "$TMPFILE")

    if [ -z "$ADMIN_NPUB" ]; then
        dialog --title "Error" --msgbox "Admin npub is required." 6 40
        clear; exit 1
    fi

    # --- Step 3: Bot account ---
    dialog --title "$DIALOG_TITLE — Bot Account" \
        --menu "Nostr account for PipeliNostr bot:" 12 60 2 \
        "generate" "Generate a new keypair" \
        "existing" "I have an nsec to paste" \
        2>"$TMPFILE"
    BOT_CHOICE=$(cat "$TMPFILE")

    if [ "$BOT_CHOICE" = "generate" ]; then
        # We need node available — install first if needed
        ensure_node_and_repo

        KEYS=$(gen_nostr_keys)
        BOT_NSEC=$(echo "$KEYS" | cut -d' ' -f1)
        BOT_NPUB=$(echo "$KEYS" | cut -d' ' -f2)

        dialog --title "$DIALOG_TITLE — New Bot Account" --msgbox "\
New keypair generated!\n\n\
npub: $BOT_NPUB\n\
nsec: $BOT_NSEC\n\n\
SAVE THE NSEC NOW — it won't be shown again.\n\
The npub is your bot's public identity.\n\
Share it so people can DM your bot." 14 70
    else
        dialog --title "$DIALOG_TITLE — Bot Account" \
            --inputbox "Paste the bot's nsec:" \
            10 70 2>"$TMPFILE"
        BOT_NSEC=$(cat "$TMPFILE")

        if [ -z "$BOT_NSEC" ]; then
            dialog --title "Error" --msgbox "nsec is required." 6 40
            clear; exit 1
        fi

        ensure_node_and_repo
        BOT_NPUB=$(npub_from_nsec "$BOT_NSEC")

        dialog --title "$DIALOG_TITLE — Bot Account" --msgbox "\
Bot npub: $BOT_NPUB" 7 70
    fi

    # --- Step 4: Handler selection (1/2) — which to enable ---
    declare -A ENV_VARS

    dialog --title "$DIALOG_TITLE — Handlers (1/2)" \
        --checklist "Select handlers to ENABLE.\nSpace to toggle, Enter to confirm." \
        24 70 14 \
        "telegram"    "Telegram bot messages"          off \
        "email"       "Email via SMTP"                 off \
        "zulip"       "Zulip messaging"                off \
        "mastodon"    "Mastodon toots"                 off \
        "bluesky"     "Bluesky posts"                  off \
        "discord"     "Discord webhooks"               off \
        "slack"       "Slack webhooks"                 off \
        "claude"      "Claude AI chat"                 off \
        "gpio"        "Raspberry Pi GPIO"              off \
        "ntfy"        "ntfy.sh notifications"          off \
        "tts"         "Text-to-speech (espeak-ng)"     off \
        "ftp"         "FTP upload"                     off \
        "mongodb"     "MongoDB operations"             off \
        "traccar_sms" "SMS via Traccar"                off \
        2>"$TMPFILE"
    SELECTED_HANDLERS=$(cat "$TMPFILE" | tr -d '"')

    # --- Step 5: Configure now? (2/2) — which to set up credentials ---
    SETUP_NOW_HANDLERS=""

    if [ -n "$SELECTED_HANDLERS" ]; then
        # Build checklist from selected handlers
        CONFIGURE_LIST=""
        for h in $SELECTED_HANDLERS; do
            CONFIGURE_LIST="$CONFIGURE_LIST $h $h off"
        done

        dialog --title "$DIALOG_TITLE — Handlers (2/2)" \
            --checklist "Which handlers to configure NOW?\nUnselected ones will be enabled without credentials." \
            20 70 14 \
            $CONFIGURE_LIST \
            2>"$TMPFILE"
        SETUP_NOW_HANDLERS=$(cat "$TMPFILE" | tr -d '"')
    fi

    # --- Handler credentials (only for "configure now") ---
    for handler in $SETUP_NOW_HANDLERS; do
        case $handler in
            telegram)
                dialog --title "Telegram" --inputbox "Bot token (from @BotFather):" 10 70 2>"$TMPFILE"
                ENV_VARS[TELEGRAM_BOT_TOKEN]=$(cat "$TMPFILE")
                dialog --title "Telegram" --inputbox "Default chat ID (optional):" 10 70 2>"$TMPFILE"
                ENV_VARS[TELEGRAM_CHAT_ID]=$(cat "$TMPFILE")
                ;;
            email)
                dialog --title "Email" --inputbox "SMTP host (e.g. smtp.gmail.com):" 10 70 2>"$TMPFILE"
                ENV_VARS[SMTP_HOST]=$(cat "$TMPFILE")
                dialog --title "Email" --inputbox "SMTP port (465=SSL, 587=TLS):" 10 70 "587" 2>"$TMPFILE"
                ENV_VARS[SMTP_PORT]=$(cat "$TMPFILE")
                dialog --title "Email" --inputbox "SMTP username:" 10 70 2>"$TMPFILE"
                ENV_VARS[SMTP_USER]=$(cat "$TMPFILE")
                dialog --title "Email" --passwordbox "SMTP password:" 10 70 2>"$TMPFILE"
                ENV_VARS[SMTP_PASSWORD]=$(cat "$TMPFILE")
                ;;
            zulip)
                dialog --title "Zulip" --inputbox "Site URL (e.g. https://org.zulipchat.com):" 10 70 2>"$TMPFILE"
                ENV_VARS[ZULIP_SITE_URL]=$(cat "$TMPFILE")
                dialog --title "Zulip" --inputbox "Bot email:" 10 70 2>"$TMPFILE"
                ENV_VARS[ZULIP_EMAIL]=$(cat "$TMPFILE")
                dialog --title "Zulip" --passwordbox "API key:" 10 70 2>"$TMPFILE"
                ENV_VARS[ZULIP_API_KEY]=$(cat "$TMPFILE")
                ;;
            mastodon)
                dialog --title "Mastodon" --inputbox "Instance URL (e.g. https://mastodon.social):" 10 70 2>"$TMPFILE"
                ENV_VARS[MASTODON_INSTANCE_URL]=$(cat "$TMPFILE")
                dialog --title "Mastodon" --passwordbox "Access token:" 10 70 2>"$TMPFILE"
                ENV_VARS[MASTODON_ACCESS_TOKEN]=$(cat "$TMPFILE")
                ;;
            bluesky)
                dialog --title "Bluesky" --inputbox "Handle (e.g. user.bsky.social):" 10 70 2>"$TMPFILE"
                ENV_VARS[BLUESKY_IDENTIFIER]=$(cat "$TMPFILE")
                dialog --title "Bluesky" --passwordbox "App password:" 10 70 2>"$TMPFILE"
                ENV_VARS[BLUESKY_PASSWORD]=$(cat "$TMPFILE")
                ;;
            discord)
                dialog --title "Discord" --passwordbox "Webhook URL:" 10 70 2>"$TMPFILE"
                ENV_VARS[DISCORD_WEBHOOK_URL]=$(cat "$TMPFILE")
                ;;
            slack)
                dialog --title "Slack" --passwordbox "Incoming webhook URL:" 10 70 2>"$TMPFILE"
                ENV_VARS[SLACK_WEBHOOK_URL]=$(cat "$TMPFILE")
                ;;
            claude)
                dialog --title "Claude AI" --passwordbox "Anthropic API key:" 10 70 2>"$TMPFILE"
                ENV_VARS[ANTHROPIC_API_KEY]=$(cat "$TMPFILE")
                ;;
            ntfy)
                dialog --title "ntfy" --inputbox "Default topic:" 10 70 "pipelinostr" 2>"$TMPFILE"
                ENV_VARS[NTFY_TOPIC]=$(cat "$TMPFILE")
                ;;
            traccar_sms)
                dialog --title "Traccar SMS" --inputbox "Gateway URL:" 10 70 2>"$TMPFILE"
                ENV_VARS[TRACCAR_GATEWAY_URL]=$(cat "$TMPFILE")
                dialog --title "Traccar SMS" --passwordbox "Token:" 10 70 2>"$TMPFILE"
                ENV_VARS[TRACCAR_TOKEN]=$(cat "$TMPFILE")
                ;;
            ftp)
                dialog --title "FTP" --inputbox "Host:" 10 70 2>"$TMPFILE"
                ENV_VARS[FTP_HOST]=$(cat "$TMPFILE")
                dialog --title "FTP" --inputbox "Username:" 10 70 2>"$TMPFILE"
                ENV_VARS[FTP_USER]=$(cat "$TMPFILE")
                dialog --title "FTP" --passwordbox "Password:" 10 70 2>"$TMPFILE"
                ENV_VARS[FTP_PASS]=$(cat "$TMPFILE")
                ;;
            mongodb)
                dialog --title "MongoDB" --passwordbox "Connection string (mongodb://...):" 10 70 2>"$TMPFILE"
                ENV_VARS[MONGODB_URI]=$(cat "$TMPFILE")
                dialog --title "MongoDB" --inputbox "Database name:" 10 70 "pipelinostr" 2>"$TMPFILE"
                ENV_VARS[MONGODB_DATABASE]=$(cat "$TMPFILE")
                ;;
        esac
    done

    # --- Step 6: Webhook API ---
    WEBHOOK_ENABLED="false"
    WEBHOOK_PORT=3000
    WEBHOOK_SECRET=""

    dialog --title "$DIALOG_TITLE — Webhook API" \
        --yesno "Enable webhook API endpoint?\n(Receive HTTP events from external services)" 8 60
    if [ $? -eq 0 ]; then
        WEBHOOK_ENABLED="true"
        WEBHOOK_SECRET=$(gen_secret)

        dialog --title "$DIALOG_TITLE — Webhook API" \
            --inputbox "Port (default 3000):" 10 50 "3000" 2>"$TMPFILE"
        WEBHOOK_PORT=$(cat "$TMPFILE")

        # Check port
        if port_in_use "$WEBHOOK_PORT"; then
            dialog --title "Warning" --yesno "Port $WEBHOOK_PORT is already in use.\nChoose a different port?" 8 50
            if [ $? -eq 0 ]; then
                dialog --title "$DIALOG_TITLE — Webhook API" \
                    --inputbox "Alternative port:" 10 50 "3099" 2>"$TMPFILE"
                WEBHOOK_PORT=$(cat "$TMPFILE")
            fi
        fi
    fi

    # --- Step 7: Workflow selection ---
    # Build checklist from available workflows
    WORKFLOW_LIST=""
    if [ -d "$INSTALL_DIR/workflows" ]; then
        for wf in "$INSTALL_DIR"/workflows/*.yml.example; do
            [ -f "$wf" ] || continue
            id=$(basename "$wf" .yml.example)
            # System workflows on by default
            if [[ "$id" == pipelinostr-* ]] || [[ "$id" == auto-reply ]] || [[ "$id" == dpo-command ]]; then
                WORKFLOW_LIST="$WORKFLOW_LIST $id . on"
            else
                WORKFLOW_LIST="$WORKFLOW_LIST $id . off"
            fi
        done
    fi

    if [ -n "$WORKFLOW_LIST" ]; then
        eval dialog --title \"$DIALOG_TITLE — Workflows\" \
            --checklist \"Select workflows to enable:\" \
            30 70 20 $WORKFLOW_LIST 2>"$TMPFILE"
        SELECTED_WORKFLOWS=$(cat "$TMPFILE" | tr -d '"')
    else
        SELECTED_WORKFLOWS=""
    fi

    # --- Step 8: Queue ---
    dialog --title "$DIALOG_TITLE — Queue" \
        --yesno "Enable event queue?\n(Retry failed workflows automatically)" 8 60
    QUEUE_ENABLED=$( [ $? -eq 0 ] && echo "true" || echo "false" )

    # --- Step 9: Whitelist ---
    WHITELIST_MODE="admin"
    dialog --title "$DIALOG_TITLE — Whitelist" \
        --menu "Who can DM the bot?" 12 60 3 \
        "admin"    "Only admin npub (most secure)" \
        "custom"   "Admin + other npubs" \
        "everyone" "Everyone (no whitelist)" \
        2>"$TMPFILE"
    WHITELIST_MODE=$(cat "$TMPFILE")

    EXTRA_NPUBS=""
    if [ "$WHITELIST_MODE" = "custom" ]; then
        dialog --title "$DIALOG_TITLE — Whitelist" \
            --inputbox "Additional npubs (one per line, or comma-separated):" \
            12 70 2>"$TMPFILE"
        EXTRA_NPUBS=$(cat "$TMPFILE")
    fi

    # --- Step 11: Summary ---
    WF_COUNT=$(echo "$SELECTED_WORKFLOWS" | wc -w)
    H_COUNT=$(echo "$SELECTED_HANDLERS" | wc -w)
    WL_DESC="$WHITELIST_MODE"
    [ "$WHITELIST_MODE" = "everyone" ] && WL_DESC="disabled (everyone)"

    dialog --title "$DIALOG_TITLE — Summary" --yesno "\
Admin npub: ${ADMIN_NPUB:0:20}...\n\
Bot npub: ${BOT_NPUB:0:20}...\n\
Handlers: $H_COUNT enabled\n\
Workflows: $WF_COUNT enabled\n\
Webhook: $WEBHOOK_ENABLED (port $WEBHOOK_PORT)\n\
Queue: $QUEUE_ENABLED\n\
Whitelist: $WL_DESC\n\n\
Proceed with installation?" 16 60

    if [ $? -ne 0 ]; then
        dialog --title "Cancelled" --msgbox "Setup cancelled." 6 30
        clear; exit 0
    fi

    # --- Step 12: Processing ---
    {
        echo "10"; echo "XXX"; echo "Writing .env..."; echo "XXX"
        write_env_file
        sleep 0.5

        echo "20"; echo "XXX"; echo "Writing config.yml..."; echo "XXX"
        write_config_file
        sleep 0.5

        echo "30"; echo "XXX"; echo "Writing handler configs..."; echo "XXX"
        write_handler_configs
        sleep 0.5

        echo "40"; echo "XXX"; echo "Deploying workflows..."; echo "XXX"
        deploy_workflows
        sleep 0.5

        echo "45"; echo "XXX"; echo "Installing system dependencies..."; echo "XXX"
        install_system_deps
        sleep 0.5

        echo "48"; echo "XXX"; echo "Clearing unused files..."; echo "XXX"
        clear_unused_files
        sleep 0.5

        echo "50"; echo "XXX"; echo "Creating pipelinostr user..."; echo "XXX"
        create_user
        sleep 0.5

        echo "60"; echo "XXX"; echo "Setting permissions..."; echo "XXX"
        chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
        chmod 600 "$INSTALL_DIR/.env"
        sleep 0.5

        echo "70"; echo "XXX"; echo "Creating systemd service..."; echo "XXX"
        create_service
        sleep 0.5

        echo "80"; echo "XXX"; echo "Starting PipeliNostr..."; echo "XXX"
        systemctl start "$SERVICE_NAME" 2>/dev/null || true
        sleep 2

        echo "100"; echo "XXX"; echo "Done!"; echo "XXX"
    } | dialog --title "$DIALOG_TITLE — Installing" --gauge "Starting..." 8 60 0

    # --- Final screen (plain terminal so user can copy) ---
    clear
    STATUS=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo "unknown")

    echo ""
    echo "==========================================="
    echo "  PipeliNostr v2 — Installation complete!"
    echo "==========================================="
    echo ""
    echo "  Bot npub:    $BOT_NPUB"
    echo "  Admin npub:  $ADMIN_NPUB"
    echo "  Status:      $STATUS"
    echo "  Install dir: $INSTALL_DIR"
    echo ""
    if [ "$WEBHOOK_ENABLED" = "true" ]; then
        echo "  Webhook port:   $WEBHOOK_PORT"
        echo "  Webhook secret: $WEBHOOK_SECRET"
        echo ""
        echo "  (Save the webhook secret — it won't be shown again)"
        echo ""
    fi
    echo "  Commands:"
    echo "    systemctl status $SERVICE_NAME"
    echo "    journalctl -u $SERVICE_NAME -f"
    echo "    $INSTALL_DIR/scripts/setup-wizard.sh  (reconfigure)"
    echo ""
}

# ============================================================
# EXISTING INSTALL MENU
# ============================================================

existing_install() {
    while true; do
    dialog --cancel-label "Exit" --title "$DIALOG_TITLE — Maintenance" \
        --menu "PipeliNostr is already installed.\nWhat would you like to do?" 18 60 6 \
        "update"    "Download latest code & restart" \
        "edit"      "Edit configuration" \
        "monitor"   "View logs & queue" \
        "reinstall" "Reinstall code (keep config)" \
        "reset"     "Reset installation (wipe config & DB)" \
        "delete"    "Delete PipeliNostr completely" \
        2>"$TMPFILE"
    CHOICE=$(cat "$TMPFILE")

    [ -z "$CHOICE" ] && return

    case $CHOICE in
        update)
            {
                echo "10"; echo "XXX"; echo "Pulling latest code..."; echo "XXX"
                cd "$INSTALL_DIR"
                git pull origin "$BRANCH" >/dev/null 2>&1
                echo "30"; echo "XXX"; echo "Installing system dependencies..."; echo "XXX"
                install_all_system_deps
                echo "40"; echo "XXX"; echo "Cleaning dev files..."; echo "XXX"
                clean_prod_files
                echo "50"; echo "XXX"; echo "Installing dependencies..."; echo "XXX"
                cd "$INSTALL_DIR" && npm install >/dev/null 2>&1
                echo "70"; echo "XXX"; echo "Building..."; echo "XXX"
                cd "$INSTALL_DIR" && npm run build >/dev/null 2>&1
                chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
                echo "90"; echo "XXX"; echo "Restarting service..."; echo "XXX"
                systemctl restart "$SERVICE_NAME"
                sleep 2
                echo "100"; echo "XXX"; echo "Done!"; echo "XXX"
            } | dialog --title "$DIALOG_TITLE — Update" --gauge "Updating..." 8 60 0

            clear
            STATUS=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo "unknown")
            echo ""
            echo "  Update complete!"
            echo "  Service status: $STATUS"
            echo ""
            # Re-exec self with updated code
            exec bash "$INSTALL_DIR/scripts/setup-wizard.sh"
            ;;
        edit)
            edit_configuration
            ;;
        monitor)
            monitor_menu
            ;;
        reinstall)
            {
                echo "5"; echo "XXX"; echo "Stopping service..."; echo "XXX"
                systemctl stop "$SERVICE_NAME" 2>/dev/null || true

                echo "10"; echo "XXX"; echo "Backing up config..."; echo "XXX"
                local backup_dir=$(mktemp -d)
                cp -r "$INSTALL_DIR/.env" "$backup_dir/" 2>/dev/null || true
                cp -r "$INSTALL_DIR/config" "$backup_dir/" 2>/dev/null || true
                cp -r "$INSTALL_DIR/data" "$backup_dir/" 2>/dev/null || true

                echo "20"; echo "XXX"; echo "Removing old code..."; echo "XXX"
                rm -rf "$INSTALL_DIR/src" "$INSTALL_DIR/dist" "$INSTALL_DIR/node_modules" "$INSTALL_DIR/package-lock.json"

                echo "30"; echo "XXX"; echo "Pulling fresh code..."; echo "XXX"
                cd "$INSTALL_DIR"
                git fetch origin "$BRANCH" >/dev/null 2>&1
                git reset --hard "origin/$BRANCH" >/dev/null 2>&1

                echo "40"; echo "XXX"; echo "Cleaning dev files..."; echo "XXX"
                clean_prod_files

                echo "50"; echo "XXX"; echo "Restoring config..."; echo "XXX"
                cp -r "$backup_dir/.env" "$INSTALL_DIR/" 2>/dev/null || true
                cp -rn "$backup_dir/config/"* "$INSTALL_DIR/config/" 2>/dev/null || true
                cp -r "$backup_dir/data" "$INSTALL_DIR/" 2>/dev/null || true
                rm -rf "$backup_dir"

                echo "55"; echo "XXX"; echo "Installing system dependencies..."; echo "XXX"
                install_all_system_deps

                echo "60"; echo "XXX"; echo "Ensuring swap..."; echo "XXX"
                ensure_swap

                echo "70"; echo "XXX"; echo "Installing dependencies..."; echo "XXX"
                cd "$INSTALL_DIR" && npm install >/dev/null 2>&1

                echo "85"; echo "XXX"; echo "Building..."; echo "XXX"
                cd "$INSTALL_DIR" && npm run build >/dev/null 2>&1

                echo "90"; echo "XXX"; echo "Setting permissions..."; echo "XXX"
                chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

                echo "95"; echo "XXX"; echo "Restarting service..."; echo "XXX"
                systemctl start "$SERVICE_NAME" 2>/dev/null || true
                sleep 2

                echo "100"; echo "XXX"; echo "Done!"; echo "XXX"
            } | dialog --title "$DIALOG_TITLE — Reinstall" --gauge "Reinstalling..." 8 60 0

            clear
            STATUS=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo "unknown")
            echo ""
            echo "  Reinstall complete!"
            echo "  Config, .env, and data preserved."
            echo "  Service status: $STATUS"
            echo ""
            ;;
        reset)
            dialog --title "$DIALOG_TITLE — Reset" \
                --yesno "This will delete all config, database, and logs.\nThe code will be kept.\n\nAre you sure?" 10 50
            if [ $? -eq 0 ]; then
                systemctl stop "$SERVICE_NAME" 2>/dev/null || true
                rm -rf "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/.env"
                rm -rf "$INSTALL_DIR/config/config.yml" "$INSTALL_DIR/config/handlers/"*.yml "$INSTALL_DIR/config/workflows/"*.yml
                dialog --title "$DIALOG_TITLE" --msgbox "Reset complete.\nRun this wizard again to reconfigure." 7 50
                fresh_install
            fi
            ;;
        delete)
            dialog --title "$DIALOG_TITLE — DELETE" \
                --yesno "This will PERMANENTLY delete:\n- Service\n- User\n- All files in $INSTALL_DIR\n\nTHIS CANNOT BE UNDONE." 12 50
            if [ $? -eq 0 ]; then
                systemctl stop "$SERVICE_NAME" 2>/dev/null || true
                systemctl disable "$SERVICE_NAME" 2>/dev/null || true
                rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
                rm -f "/etc/sudoers.d/${SERVICE_NAME}"
                systemctl daemon-reload
                userdel -r "$SERVICE_USER" 2>/dev/null || true
                rm -rf "$INSTALL_DIR"
                clear
                echo ""
                echo "  PipeliNostr deleted."
                echo ""
            fi
            ;;
    esac
    done
}

# ============================================================
# EDIT CONFIGURATION
# ============================================================

edit_configuration() {
    while true; do
        dialog --title "$DIALOG_TITLE — Edit" \
            --menu "What to edit?" 16 60 5 \
            "handlers"       "Enable/disable handlers" \
            "workflows"      "Enable/disable workflows" \
            "workflow_edit"  "View/edit a workflow" \
            "credentials"    "Update API keys & passwords" \
            "queue"          "Clear pending queue entries" \
            2>"$TMPFILE"
        EDIT_CHOICE=$(cat "$TMPFILE")

        [ -z "$EDIT_CHOICE" ] && break

        case $EDIT_CHOICE in
            handlers)
                edit_handlers
                ;;
            workflows)
                edit_workflows
                ;;
            workflow_edit)
                view_edit_workflow
                ;;
            credentials)
                edit_credentials
                ;;
            queue)
                edit_queue
                ;;
        esac
    done

    # Ask to restart if changes were made
    dialog --title "$DIALOG_TITLE" \
        --yesno "Restart PipeliNostr to apply changes?" 7 50
    if [ $? -eq 0 ]; then
        systemctl restart "$SERVICE_NAME"
        clear
        echo ""
        echo "  PipeliNostr restarted."
        echo "  Status: $(systemctl is-active $SERVICE_NAME 2>/dev/null)"
        echo ""
    else
        clear
        echo ""
        echo "  Changes saved. Restart manually: systemctl restart $SERVICE_NAME"
        echo ""
    fi
}

edit_handlers() {
    local hdir="$INSTALL_DIR/config/handlers"

    dialog --title "$DIALOG_TITLE — Handlers" \
        --menu "Handler management:" 12 60 3 \
        "toggle"      "Enable/disable handlers" \
        "refresh_all" "Refresh all from examples" \
        2>"$TMPFILE"
    local CHOICE=$(cat "$TMPFILE")

    [ -z "$CHOICE" ] && return

    case $CHOICE in
        toggle)
            toggle_handlers
            ;;
        refresh_all)
            refresh_all_handlers
            ;;
    esac
}

toggle_handlers() {
    local hdir="$INSTALL_DIR/config/handlers"
    local HANDLER_LIST=""
    local all_handlers=""

    # Build list dynamically from available examples
    for f in "$hdir"/*.yml.example; do
        [ -f "$f" ] || continue
        local h=$(basename "$f" .yml.example)
        all_handlers="$all_handlers $h"
        local status="off"
        [ -f "$hdir/$h.yml" ] && status="on"
        HANDLER_LIST="$HANDLER_LIST $h $h $status"
    done

    if [ -z "$HANDLER_LIST" ]; then
        dialog --title "$DIALOG_TITLE" --msgbox "No handler examples found." 6 40
        return
    fi

    eval dialog --title \"$DIALOG_TITLE — Handlers\" \
        --checklist \"Toggle handlers \(space to toggle\):\" \
        30 60 20 $HANDLER_LIST 2>"$TMPFILE"
    local EXIT_CODE=$?
    local NEW_HANDLERS=$(cat "$TMPFILE" | tr -d '"')

    # Back = cancel, don't change anything
    [ $EXIT_CODE -ne 0 ] && return

    # Enable selected, disable others
    for h in $all_handlers; do
        if echo " $NEW_HANDLERS " | grep -q " $h "; then
            # Enable: create config if not exists
            if [ ! -f "$hdir/$h.yml" ]; then
                local example="$hdir/$h.yml.example"
                if [ -f "$example" ]; then
                    cp "$example" "$hdir/$h.yml"
                else
                    echo "enabled: true" > "$hdir/$h.yml"
                fi
            fi
        else
            # Disable: remove config
            rm -f "$hdir/$h.yml"
        fi
    done
}

refresh_all_handlers() {
    local hdir="$INSTALL_DIR/config/handlers"
    local count=0

    for f in "$hdir"/*.yml; do
        [ -f "$f" ] || continue
        local name=$(basename "$f" .yml)
        local example="$INSTALL_DIR/config/handlers/$name.yml.example"
        if [ -f "$example" ]; then
            cp "$example" "$f"
            count=$((count + 1))
        fi
    done

    dialog --title "$DIALOG_TITLE" --msgbox "Refreshed $count handler(s) from examples." 6 50
}

edit_workflows() {
    local wfdir="$INSTALL_DIR/config/workflows"
    local exdir="$INSTALL_DIR/workflows"
    local WF_LIST=""

    # Build list from examples + deployed
    local all_ids=""
    for f in "$exdir"/*.yml.example; do
        [ -f "$f" ] || continue
        local id=$(basename "$f" .yml.example)
        all_ids="$all_ids $id"
    done
    for f in "$wfdir"/*.yml; do
        [ -f "$f" ] || continue
        local id=$(basename "$f" .yml)
        echo " $all_ids " | grep -q " $id " || all_ids="$all_ids $id"
    done

    for id in $all_ids; do
        local status="off"
        [ -f "$wfdir/$id.yml" ] && status="on"
        WF_LIST="$WF_LIST $id . $status"
    done

    if [ -z "$WF_LIST" ]; then
        dialog --title "$DIALOG_TITLE" --msgbox "No workflows found." 6 40
        return
    fi

    eval dialog --title \"$DIALOG_TITLE — Workflows\" \
        --checklist \"Toggle workflows:\" \
        30 70 20 $WF_LIST 2>"$TMPFILE"
    local EXIT_CODE=$?
    local NEW_WF=$(cat "$TMPFILE" | tr -d '"')

    # Back = cancel, don't change anything
    [ $EXIT_CODE -ne 0 ] && return

    # Enable selected, disable others
    for id in $all_ids; do
        if echo " $NEW_WF " | grep -q " $id "; then
            # Enable: deploy from example if not exists
            if [ ! -f "$wfdir/$id.yml" ]; then
                local src="$exdir/$id.yml.example"
                if [ -f "$src" ]; then
                    cp "$src" "$wfdir/$id.yml"
                    sed -i 's/^enabled:.*/enabled: true/' "$wfdir/$id.yml"
                fi
            fi
        else
            # Disable: remove deployed workflow
            rm -f "$wfdir/$id.yml"
        fi
    done
}

edit_credentials() {
    local envfile="$INSTALL_DIR/.env"
    [ -f "$envfile" ] || { dialog --title "Error" --msgbox "No .env file found." 6 40; return; }

    while true; do
        # Build menu from env vars
        local MENU_ITEMS=""
        while IFS='=' read -r key value; do
            [ -z "$key" ] && continue
            [[ "$key" == \#* ]] && continue
            # Show masked value for secrets, full value for others
            local display="$value"
            case $key in
                *KEY*|*SECRET*|*PASS*|*TOKEN*|*PASSWORD*|*NSEC*|*PRIVATE*)
                    [ ${#value} -gt 8 ] && display="${value:0:4}****${value: -4}" || display="****"
                    ;;
            esac
            MENU_ITEMS="$MENU_ITEMS \"$key\" \"$display\""
        done < "$envfile"

        if [ -z "$MENU_ITEMS" ]; then
            dialog --title "$DIALOG_TITLE" --msgbox "No credentials found in .env" 6 40
            return
        fi

        # Add "done" option
        MENU_ITEMS="$MENU_ITEMS \"DONE\" \"< Back\""

        eval dialog --title \"$DIALOG_TITLE — Credentials\" \
            --menu \"Select credential to edit:\" \
            20 70 14 $MENU_ITEMS 2>"$TMPFILE"
        local SELECTED=$(cat "$TMPFILE")

        [ "$SELECTED" = "DONE" ] && return
        [ -z "$SELECTED" ] && return

        local current=$(grep "^$SELECTED=" "$envfile" | cut -d= -f2-)
        local is_secret=false
        case $SELECTED in
            *KEY*|*SECRET*|*PASS*|*TOKEN*|*PASSWORD*|*NSEC*|*PRIVATE*) is_secret=true ;;
        esac

        if $is_secret; then
            dialog --title "Edit: $SELECTED" \
                --passwordbox "New value (empty = keep current):" \
                10 70 2>"$TMPFILE"
        else
            dialog --title "Edit: $SELECTED" \
                --inputbox "New value (empty = keep current):" \
                10 70 "$current" 2>"$TMPFILE"
        fi

        local new_value=$(cat "$TMPFILE")
        if [ -n "$new_value" ]; then
            sed -i "s|^$SELECTED=.*|$SELECTED=$new_value|" "$envfile"
        fi
    done

    chmod 600 "$envfile"
    chown "$SERVICE_USER":"$SERVICE_USER" "$envfile"
}

edit_queue() {
    dialog --title "$DIALOG_TITLE — Queue" \
        --yesno "Clear all pending and failed queue entries?\n\nThis stops replaying old events." 9 50
    if [ $? -eq 0 ]; then
        cd "$INSTALL_DIR"
        node -e "const D=require('better-sqlite3');const d=new D('data/pipelinostr.db');const r=d.prepare('DELETE FROM queue').run();console.log(r.changes);d.close();" 2>/dev/null
        dialog --title "$DIALOG_TITLE" --msgbox "Queue cleared." 6 30
    fi
}

# ============================================================
# VIEW / EDIT WORKFLOW
# ============================================================

view_edit_workflow() {
    local wfdir="$INSTALL_DIR/config/workflows"
    local exdir="$INSTALL_DIR/workflows"

    while true; do
        # Build list of all workflows (deployed + examples)
        local MENU_ITEMS=""
        local all_files=""

        # Only show enabled (deployed) workflows
        if [ -d "$wfdir" ]; then
            for f in "$wfdir"/*.yml; do
                [ -f "$f" ] || continue
                local id=$(basename "$f" .yml)
                MENU_ITEMS="$MENU_ITEMS \"$id\" \"$id\""
                all_files="$all_files $id:$f"
            done
        fi

        if [ -z "$MENU_ITEMS" ]; then
            dialog --title "$DIALOG_TITLE" --msgbox "No workflows found." 6 40
            return
        fi

        MENU_ITEMS="$MENU_ITEMS \"DONE\" \"< Back\""

        eval dialog --title \"$DIALOG_TITLE — View/Edit Workflow\" \
            --menu \"Select a workflow:\" \
            30 70 20 $MENU_ITEMS 2>"$TMPFILE"
        local SELECTED=$(cat "$TMPFILE")

        [ "$SELECTED" = "DONE" ] && return
        [ -z "$SELECTED" ] && return

        # Find the file path
        local filepath=""
        for entry in $all_files; do
            local eid=$(echo "$entry" | cut -d: -f1)
            local epath=$(echo "$entry" | cut -d: -f2-)
            if [ "$eid" = "$SELECTED" ]; then
                filepath="$epath"
                break
            fi
        done

        [ -z "$filepath" ] && continue

        # Show preview with Edit option
        local content=$(head -40 "$filepath")
        dialog --title "Workflow: $SELECTED" \
            --yes-label "Edit" --no-label "Back" \
            --yesno "$content" 30 80
        local EXIT_CODE=$?

        # 0 = Edit, 1 = Back
        if [ $EXIT_CODE -eq 0 ]; then
            clear
            nano "$filepath" < /dev/tty
            # Validate YAML after edit
            if ! node -e "require('yaml').parse(require('fs').readFileSync('$filepath','utf-8'))" 2>/dev/null; then
                dialog --title "Warning" --msgbox "YAML syntax error in $SELECTED.yml\nPlease fix it." 7 50
            fi
        fi
    done
}

# ============================================================
# MONITOR (logs + queue)
# ============================================================

monitor_menu() {
    while true; do
        dialog --title "$DIALOG_TITLE — Monitor" \
            --menu "What to view?" 14 60 4 \
            "logs"    "Follow live logs" \
            "relays"  "Relay connection status" \
            "queue"   "View queue status" \
            "clear"   "Clear queue" \
            "check"   "Handler/workflow consistency" \
            2>"$TMPFILE"
        local CHOICE=$(cat "$TMPFILE")

        [ -z "$CHOICE" ] && return

        case $CHOICE in
            logs)
                monitor_logs
                ;;
            relays)
                monitor_relays
                ;;
            queue)
                monitor_queue
                ;;
            clear)
                edit_queue
                ;;
            check)
                check_consistency
                ;;
        esac
    done
}

check_consistency() {
    local hdir="$INSTALL_DIR/config/handlers"
    local wfdir="$INSTALL_DIR/config/workflows"
    local report=""

    # Get enabled handlers
    local handlers=""
    for f in "$hdir"/*.yml; do
        [ -f "$f" ] || continue
        local h=$(basename "$f" .yml)
        handlers="$handlers $h"
    done

    # Get handler types used by workflows
    local used_handlers=""
    local missing=""
    for f in "$wfdir"/*.yml; do
        [ -f "$f" ] || continue
        local wf=$(basename "$f" .yml)
        local types=$(grep -E '^\s+type:' "$f" | sed 's/.*type:\s*//' | tr -d '"' | tr -d "'")
        for t in $types; do
            # Normalize: handler files use dashes, types use underscores
            local tfile=$(echo "$t" | tr '_' '-')
            used_handlers="$used_handlers $t"
            if [ ! -f "$hdir/$tfile.yml" ] && [ ! -f "$hdir/$t.yml" ]; then
                missing="$missing\n  $wf -> $t"
            fi
        done
    done

    # Find unused handlers
    local unused=""
    for h in $handlers; do
        local hnorm=$(echo "$h" | tr '-' '_')
        if ! echo "$used_handlers" | grep -qw "$hnorm" && ! echo "$used_handlers" | grep -qw "$h"; then
            unused="$unused\n  $h"
        fi
    done

    # Build report
    report="=== Handler/Workflow Consistency ===\n\n"
    if [ -n "$missing" ]; then
        report="${report}Workflows missing a handler:$missing\n\n"
    else
        report="${report}All workflows have their handlers. OK\n\n"
    fi
    if [ -n "$unused" ]; then
        report="${report}Handlers not used by any workflow:$unused"
    else
        report="${report}No unused handlers."
    fi

    dialog --title "$DIALOG_TITLE — Consistency Check" --msgbox "$(echo -e "$report")" 20 70
}

monitor_logs() {
    local LOGFILE=$(mktemp)

    # Start journalctl in background, pipe through pino-pretty (no color), fold for wrapping
    journalctl -u "$SERVICE_NAME" --no-pager -o cat -n 50 \
        | "$INSTALL_DIR/node_modules/.bin/pino-pretty" --no-color --singleLine 2>/dev/null \
        | fold -w 115 -s \
        > "$LOGFILE" 2>/dev/null

    # Then follow new entries (stdbuf forces line buffering through the pipe)
    journalctl -f -u "$SERVICE_NAME" --no-pager -o cat 2>/dev/null \
        | stdbuf -oL "$INSTALL_DIR/node_modules/.bin/pino-pretty" --no-color --singleLine 2>/dev/null \
        | stdbuf -oL fold -w 115 -s \
        >> "$LOGFILE" 2>/dev/null &
    local JPID=$!

    sleep 1

    dialog --title "$DIALOG_TITLE — Live Logs (Escape to exit)" \
        --tailbox "$LOGFILE" 30 120

    # Cleanup background processes
    kill "$JPID" 2>/dev/null
    kill $(jobs -p) 2>/dev/null
    wait 2>/dev/null
    rm -f "$LOGFILE"
}

monitor_relays() {
    local TMPREL=$(mktemp)

    # Parse relay status from recent logs
    echo "Relay Connection Status" > "$TMPREL"
    echo "=======================" >> "$TMPREL"
    echo "" >> "$TMPREL"

    # Get configured relays from config
    local relays=$(grep "wss://" "$INSTALL_DIR/config/config.yml" 2>/dev/null | sed 's/.*- //' | tr -d ' ')

    for url in $relays; do
        # Check last log entry for this relay (JSON format, extract msg field)
        local last_msg=$(journalctl -u "$SERVICE_NAME" --no-pager -o cat 2>/dev/null \
            | grep "\"$url\"" | tail -1 \
            | sed 's/.*"msg":"//' | sed 's/"}.*//')

        if echo "$last_msg" | grep -qi "Connected\|EOSE"; then
            echo "  CONNECTED     $url" >> "$TMPREL"
        elif echo "$last_msg" | grep -qi "disconnected"; then
            echo "  DISCONNECTED  $url (auto-reconnect)" >> "$TMPREL"
        elif echo "$last_msg" | grep -qi "Failed"; then
            echo "  FAILED        $url" >> "$TMPREL"
        elif [ -n "$last_msg" ]; then
            echo "  $last_msg  $url" >> "$TMPREL"
        else
            echo "  NO DATA       $url" >> "$TMPREL"
        fi
    done

    echo "" >> "$TMPREL"

    # EOSE status
    local eose_count=$(journalctl -u "$SERVICE_NAME" --no-pager -o cat 2>/dev/null \
        | grep -c "EOSE received")
    echo "EOSE received: $eose_count relay(s)" >> "$TMPREL"

    # NIP-65 published
    local nip65=$(journalctl -u "$SERVICE_NAME" --no-pager -o cat 2>/dev/null \
        | grep "Published relay lists" | tail -1)
    if [ -n "$nip65" ]; then
        echo "NIP-65 relay list: published" >> "$TMPREL"
    else
        echo "NIP-65 relay list: not published" >> "$TMPREL"
    fi

    # Service uptime
    local uptime=$(systemctl show "$SERVICE_NAME" --property=ActiveEnterTimestamp 2>/dev/null | cut -d= -f2)
    if [ -n "$uptime" ]; then
        echo "" >> "$TMPREL"
        echo "Service started: $uptime" >> "$TMPREL"
    fi

    dialog --title "$DIALOG_TITLE — Relay Status" --msgbox "$(cat "$TMPREL")" 22 70
    rm -f "$TMPREL"
}

monitor_queue() {
    local QINFO=$(cd "$INSTALL_DIR" && node -e "
const D=require('better-sqlite3');
const d=new D('data/pipelinostr.db');
const rows=d.prepare('SELECT status, COUNT(*) as count FROM queue GROUP BY status').all();
const total=d.prepare('SELECT COUNT(*) as c FROM queue').get();
const recent=d.prepare('SELECT id, workflow_id, status, created_at FROM queue ORDER BY id DESC LIMIT 20').all();
console.log('Queue Summary');
console.log('=============');
console.log('Total entries: ' + total.c);
rows.forEach(r => console.log('  ' + r.status + ': ' + r.count));
console.log('');
console.log('Recent entries:');
console.log('---------------');
recent.forEach(r => console.log('#' + r.id + ' | ' + r.workflow_id + ' | ' + r.status + ' | ' + r.created_at));
d.close();
" 2>/dev/null)

    local QTMPFILE=$(mktemp)
    echo "$QINFO" > "$QTMPFILE"
    dialog --title "$DIALOG_TITLE — Queue Status" --textbox "$QTMPFILE" 30 90
    rm -f "$QTMPFILE"
}

# ============================================================
# FILE GENERATORS
# ============================================================

write_env_file() {
    local envfile="$INSTALL_DIR/.env"
    cat > "$envfile" << EOF
# PipeliNostr — generated by setup wizard
NOSTR_PRIVATE_KEY=$BOT_NSEC
EOF

    # Add handler credentials
    for key in "${!ENV_VARS[@]}"; do
        echo "$key=${ENV_VARS[$key]}" >> "$envfile"
    done

    # Webhook secret
    if [ "$WEBHOOK_ENABLED" = "true" ]; then
        echo "WEBHOOK_SECRET=$WEBHOOK_SECRET" >> "$envfile"
    fi
}

write_config_file() {
    local cfgfile="$INSTALL_DIR/config/config.yml"
    mkdir -p "$INSTALL_DIR/config"

    # Build whitelist
    local whitelist_yaml=""
    case $WHITELIST_MODE in
        admin)
            whitelist_yaml="  whitelist:\n    - $ADMIN_NPUB"
            ;;
        custom)
            whitelist_yaml="  whitelist:\n    - $ADMIN_NPUB"
            for npub in $(echo "$EXTRA_NPUBS" | tr ',' '\n' | tr -d ' '); do
                [ -n "$npub" ] && whitelist_yaml="$whitelist_yaml\n    - $npub"
            done
            ;;
        everyone)
            whitelist_yaml="  whitelist:\n    - \"*\""
            ;;
    esac

    cat > "$cfgfile" << EOF
nostr:
  private_key: env:NOSTR_PRIVATE_KEY
  relays:
    - wss://relay.damus.io
    - wss://nos.lol
    - wss://relay.nostr.band
    - wss://nostr.wine
    - wss://relay.snort.social
$(echo -e "$whitelist_yaml")

database:
  path: data/pipelinostr.db

queue:
  enabled: $QUEUE_ENABLED
  poll_interval_ms: 1000

log_level: info
max_hook_depth: 10
EOF

    if [ "$WEBHOOK_ENABLED" = "true" ]; then
        cat >> "$cfgfile" << EOF

webhook:
  enabled: true
  port: $WEBHOOK_PORT
  secret: env:WEBHOOK_SECRET
EOF
    fi
}

write_handler_configs() {
    local hdir="$INSTALL_DIR/config/handlers"
    mkdir -p "$hdir"

    # Always-on handlers
    for h in http file nostr_dm nostr_note system workflow_db; do
        echo "enabled: true" > "$hdir/$h.yml"
    done

    # Selected handlers
    for handler in $SELECTED_HANDLERS; do
        case $handler in
            telegram)
                cat > "$hdir/telegram.yml" << EOF
enabled: true
bot_token: env:TELEGRAM_BOT_TOKEN
default_chat_id: env:TELEGRAM_CHAT_ID
EOF
                ;;
            email)
                cat > "$hdir/email.yml" << EOF
enabled: true
host: env:SMTP_HOST
port: ${ENV_VARS[SMTP_PORT]:-587}
auth:
  user: env:SMTP_USER
  pass: env:SMTP_PASSWORD
EOF
                ;;
            zulip)
                cat > "$hdir/zulip.yml" << EOF
enabled: true
site_url: env:ZULIP_SITE_URL
email: env:ZULIP_EMAIL
api_key: env:ZULIP_API_KEY
EOF
                ;;
            mastodon)
                cat > "$hdir/mastodon.yml" << EOF
enabled: true
instance_url: env:MASTODON_INSTANCE_URL
access_token: env:MASTODON_ACCESS_TOKEN
EOF
                ;;
            bluesky)
                cat > "$hdir/bluesky.yml" << EOF
enabled: true
identifier: env:BLUESKY_IDENTIFIER
password: env:BLUESKY_PASSWORD
EOF
                ;;
            discord)
                cat > "$hdir/discord.yml" << EOF
enabled: true
webhook_url: env:DISCORD_WEBHOOK_URL
EOF
                ;;
            slack)
                cat > "$hdir/slack.yml" << EOF
enabled: true
webhook_url: env:SLACK_WEBHOOK_URL
EOF
                ;;
            claude)
                cat > "$hdir/claude.yml" << EOF
enabled: true
api_key: env:ANTHROPIC_API_KEY
EOF
                ;;
            gpio)
                cat > "$hdir/gpio.yml" << EOF
enabled: true
EOF
                ;;
            ntfy)
                cat > "$hdir/ntfy.yml" << EOF
enabled: true
server_url: https://ntfy.sh
default_topic: env:NTFY_TOPIC
EOF
                ;;
            tts)
                cat > "$hdir/tts.yml" << EOF
enabled: true
engine: espeak
espeak_voice: fr-fr
output_dir: ./data/tts
EOF
                ;;
            ftp)
                cat > "$hdir/ftp.yml" << EOF
enabled: true
host: env:FTP_HOST
user: env:FTP_USER
password: env:FTP_PASS
EOF
                ;;
            mongodb)
                cat > "$hdir/mongodb.yml" << EOF
enabled: true
connection_string: env:MONGODB_URI
database: ${ENV_VARS[MONGODB_DATABASE]:-pipelinostr}
EOF
                ;;
            traccar_sms)
                cat > "$hdir/traccar-sms.yml" << EOF
enabled: true
gateway_url: env:TRACCAR_GATEWAY_URL
token: env:TRACCAR_TOKEN
EOF
                ;;
        esac
    done
}

deploy_workflows() {
    local wfdir="$INSTALL_DIR/config/workflows"
    mkdir -p "$wfdir"

    for wf in $SELECTED_WORKFLOWS; do
        local src="$INSTALL_DIR/workflows/${wf}.yml.example"
        local dst="$wfdir/${wf}.yml"
        if [ -f "$src" ]; then
            cp "$src" "$dst"
            # Ensure enabled
            sed -i 's/^enabled:.*/enabled: true/' "$dst"
        fi
    done
}

create_user() {
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd -r -m -d "$INSTALL_DIR" -s /bin/bash "$SERVICE_USER"
    fi
}

create_service() {
    local NODE_PATH
    NODE_PATH="$(which node)"

    cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=PipeliNostr - Nostr Event Router
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_PATH} dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=${INSTALL_DIR}/.env

NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR}
ProtectHome=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=pipelinostr

[Install]
WantedBy=multi-user.target
EOF

    # Sudoers for service user
    cat > "/etc/sudoers.d/${SERVICE_NAME}" << EOF
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart ${SERVICE_NAME}
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop ${SERVICE_NAME}
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl start ${SERVICE_NAME}
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl status ${SERVICE_NAME}
EOF
    chmod 440 "/etc/sudoers.d/${SERVICE_NAME}"

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
}

# ============================================================
# INSTALL SYSTEM DEPS FOR ENABLED HANDLERS (runs as root)
# ============================================================

install_system_deps() {
    local DEPS_TO_INSTALL=""

    for handler in $SELECTED_HANDLERS; do
        case $handler in
            tts)        DEPS_TO_INSTALL="$DEPS_TO_INSTALL espeak-ng" ;;
            gpio)       DEPS_TO_INSTALL="$DEPS_TO_INSTALL pigpio" ;;
        esac
    done

    if [ -n "$DEPS_TO_INSTALL" ]; then
        apt-get install -y -qq $DEPS_TO_INSTALL >/dev/null 2>&1 || true
    fi
}

# Install system deps by scanning enabled handler configs (for update/reinstall)
install_all_system_deps() {
    local DEPS_TO_INSTALL=""
    local hdir="$INSTALL_DIR/config/handlers"

    [ -d "$hdir" ] || return 0

    for f in "$hdir"/*.yml; do
        [ -f "$f" ] || continue
        local name=$(basename "$f" .yml)
        case $name in
            tts)   DEPS_TO_INSTALL="$DEPS_TO_INSTALL espeak-ng" ;;
            gpio)  DEPS_TO_INSTALL="$DEPS_TO_INSTALL pigpio" ;;
        esac
    done

    if [ -n "$DEPS_TO_INSTALL" ]; then
        apt-get install -y -qq $DEPS_TO_INSTALL >/dev/null 2>&1 || true
    fi
}

# ============================================================
# CLEAR UNUSED FILES (after user validation)
# ============================================================

clear_unused_files() {
    local hdir="$INSTALL_DIR/config/handlers"
    local wfdir="$INSTALL_DIR/config/workflows"

    # Remove handler configs for handlers not selected
    if [ -d "$hdir" ]; then
        for f in "$hdir"/*.yml; do
            [ -f "$f" ] || continue
            local name=$(basename "$f" .yml)
            # Keep always-on handlers
            case $name in http|file|nostr_dm|nostr_note|system|workflow_db) continue ;; esac
            # Remove if not in selected list
            if ! echo " $SELECTED_HANDLERS " | grep -q " $name "; then
                rm -f "$f"
            fi
        done
    fi

    # Remove workflow configs for workflows not selected
    if [ -d "$wfdir" ]; then
        for f in "$wfdir"/*.yml; do
            [ -f "$f" ] || continue
            local name=$(basename "$f" .yml)
            if ! echo " $SELECTED_WORKFLOWS " | grep -q " $name "; then
                rm -f "$f"
            fi
        done
    fi

    # Remove workflow examples (templates already deployed)
    rm -rf "$INSTALL_DIR/workflows"

    # Remove .prodignore itself
    rm -f "$INSTALL_DIR/.prodignore"
}

# ============================================================
# CLEAN DEV FILES FROM PRODUCTION
# ============================================================

clean_prod_files() {
    if [ -f "$INSTALL_DIR/.prodignore" ]; then
        while IFS= read -r pattern; do
            [ -z "$pattern" ] && continue
            [[ "$pattern" == \#* ]] && continue
            rm -rf "${INSTALL_DIR:?}/${pattern}"
        done < "$INSTALL_DIR/.prodignore"
    fi
}

# ============================================================
# ENSURE SWAP (prevents OOM during npm install/build)
# ============================================================

ensure_swap() {
    if [ "$(swapon --show | wc -l)" -gt 0 ]; then
        return 0 # swap already exists
    fi
    if [ -f /swapfile ]; then
        swapon /swapfile 2>/dev/null && return 0
    fi
    fallocate -l 512M /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=512 2>/dev/null
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null 2>&1
    swapon /swapfile
}

# ============================================================
# ENSURE NODE + REPO (for keypair generation)
# ============================================================

ensure_node_and_repo() {
    # Skip if already done
    [ -f "$INSTALL_DIR/node_modules/.package-lock.json" ] && return 0

    {
        echo "5"; echo "XXX"; echo "Installing system dependencies..."; echo "XXX"
        apt-get update -qq >/dev/null 2>&1
        apt-get install -y -qq git curl build-essential python3 sqlite3 >/dev/null 2>&1

        echo "20"; echo "XXX"; echo "Installing Node.js..."; echo "XXX"
        if ! command -v node &>/dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
            apt-get install -y -qq nodejs >/dev/null 2>&1
        fi

        echo "40"; echo "XXX"; echo "Cloning PipeliNostr..."; echo "XXX"
        if [ ! -d "$INSTALL_DIR/.git" ]; then
            mkdir -p "$INSTALL_DIR"
            git clone -b "$BRANCH" "$REPO" "$INSTALL_DIR" >/dev/null 2>&1
        fi

        # Remove dev-only files from production
        echo "50"; echo "XXX"; echo "Cleaning dev files..."; echo "XXX"
        clean_prod_files

        echo "55"; echo "XXX"; echo "Ensuring swap..."; echo "XXX"
        ensure_swap

        echo "60"; echo "XXX"; echo "Installing dependencies..."; echo "XXX"
        cd "$INSTALL_DIR" && npm install >/dev/null 2>&1

        echo "80"; echo "XXX"; echo "Building..."; echo "XXX"
        cd "$INSTALL_DIR" && npm run build >/dev/null 2>&1

        echo "100"; echo "XXX"; echo "Ready!"; echo "XXX"
    } | dialog --title "$DIALOG_TITLE — Preparing" --gauge "Setting up..." 8 60 0
}

# ============================================================
# MAIN
# ============================================================

if is_installed; then
    existing_install
else
    fresh_install
fi
