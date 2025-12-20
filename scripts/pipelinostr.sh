#!/bin/bash
# PipeliNostr CLI - Manage workflows and service

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORKFLOWS_DIR="$PROJECT_DIR/config/workflows"
HANDLERS_DIR="$PROJECT_DIR/config/handlers"
EXAMPLES_WORKFLOWS_DIR="$PROJECT_DIR/examples/workflows"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
    echo "PipeliNostr CLI"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  workflow list [all|enabled|disabled]  List workflows (default: all)"
    echo "  workflow enable [--force] <id|all>    Enable workflow(s), -f enables handlers too"
    echo "  workflow disable <id|all>             Disable workflow(s)"
    echo "  workflow show <id>                    Show workflow details"
    echo "  workflow refresh <id|id1,id2,...>     Refresh from example file"
    echo "  workflow load-missing                 Deploy missing workflows from examples"
    echo ""
    echo "  handler list [all|enabled|disabled]   List handlers (default: all)"
    echo "  handler enable <name|all>             Enable handler(s)"
    echo "  handler disable <name|all>            Disable handler(s)"
    echo "  handler show <name>                   Show handler config"
    echo "  handler refresh <name|name1,name2>    Refresh from example file"
    echo "  handler load-missing                  Deploy missing handlers from examples"
    echo ""
    echo "  relay list                            List all relays from database"
    echo "  relay add <wss://...>                 Add a relay"
    echo "  relay remove <wss://...>              Remove a relay"
    echo "  relay blacklist [+|-]<wss://...>      Add (+) or remove (-) from blacklist"
    echo ""
    echo "  status                                Show service status"
    echo "  restart                               Restart PipeliNostr"
    echo "  logs [lines]                          Show recent logs (default: 50)"
    echo "  help                                  Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 workflow list"
    echo "  $0 workflow list enabled"
    echo "  $0 workflow enable zulip-forward"
    echo "  $0 workflow enable --force nostr-to-telegram"
    echo "  $0 workflow disable all"
    echo "  $0 workflow disable wf1,wf2,wf3"
    echo "  $0 workflow refresh pipelinostr-status"
    echo "  $0 workflow load-missing"
    echo "  $0 handler list"
    echo "  $0 handler enable email"
    echo "  $0 handler disable traccar-sms,discord,twitter"
    echo "  $0 handler refresh telegram,email"
    echo "  $0 handler load-missing"
    echo "  $0 relay list"
    echo "  $0 relay add wss://relay.example.com"
    echo "  $0 relay blacklist +wss://spam.relay.com"
    echo "  $0 relay blacklist -wss://spam.relay.com"
    echo "  $0 logs 100"
}

# Get workflow ID from file
get_workflow_id() {
    local file="$1"
    grep -E "^id:" "$file" 2>/dev/null | head -1 | sed 's/id:\s*//' | tr -d '"' | tr -d "'"
}

# Get workflow name from file
get_workflow_name() {
    local file="$1"
    grep -E "^name:" "$file" 2>/dev/null | head -1 | sed 's/name:\s*//' | tr -d '"' | tr -d "'"
}

# Check if workflow is enabled
is_workflow_enabled() {
    local file="$1"
    grep -E "^enabled:\s*true" "$file" >/dev/null 2>&1
}

# List workflows
workflow_list() {
    local filter="${1:-all}"

    echo -e "${BLUE}Workflows in $WORKFLOWS_DIR${NC}"
    echo ""
    printf "%-25s %-30s %s\n" "ID" "NAME" "STATUS"
    printf "%-25s %-30s %s\n" "-------------------------" "------------------------------" "--------"

    for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
        [ -f "$file" ] || continue

        local id=$(get_workflow_id "$file")
        local name=$(get_workflow_name "$file")
        local status

        if is_workflow_enabled "$file"; then
            status="${GREEN}enabled${NC}"
            [ "$filter" = "disabled" ] && continue
        else
            status="${RED}disabled${NC}"
            [ "$filter" = "enabled" ] && continue
        fi

        printf "%-25s %-30s %b\n" "$id" "${name:0:30}" "$status"
    done
}

# Extract action types from workflow file
get_workflow_action_types() {
    local file="$1"
    # Extract "type:" values under actions section
    grep -E "^\s+type:\s*" "$file" 2>/dev/null | sed 's/.*type:\s*//' | tr -d '"' | tr -d "'" | sort -u
}

# Map action type to handler config name
map_action_to_handler() {
    local action_type="$1"
    # Some action types map to different handler file names
    case "$action_type" in
        nostr_dm|nostr_note) echo "" ;;  # Built-in, no config file
        http) echo "" ;;                  # Built-in, no config file
        system) echo "" ;;                # Built-in, no config file
        bebop_parser) echo "" ;;          # Built-in, no config file
        dpo_report) echo "" ;;            # Built-in, no config file
        workflow_activator) echo "" ;;    # Built-in, no config file
        morse_audio) echo "" ;;           # Built-in, no config file
        traccar_sms) echo "traccar-sms" ;;
        usb_hid) echo "usb-hid" ;;
        *) echo "$action_type" ;;         # Most handlers: type = filename
    esac
}

# Enable a single handler by name (internal helper)
enable_handler_internal() {
    local handler_name="$1"

    for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
        [ -f "$file" ] || continue
        local name=$(get_handler_name "$file")

        if [ "$name" = "$handler_name" ]; then
            if ! is_handler_enabled "$file"; then
                sed -i 's/^\(\s*\)enabled:\s*false/\1enabled: true/' "$file"
                echo -e "${GREEN}✓${NC} Handler enabled: $name"
                return 0
            fi
            return 1  # Already enabled
        fi
    done
    return 2  # Not found
}

# Enable workflow (supports comma-separated list and --force)
workflow_enable() {
    local input=""
    local force=0

    # Parse arguments
    for arg in "$@"; do
        case "$arg" in
            --force|-f) force=1 ;;
            *) input="$arg" ;;
        esac
    done

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing workflow ID${NC}"
        echo "Usage: $0 workflow enable [--force] <id|id1,id2,...|all>"
        exit 1
    fi

    local total_count=0
    local not_found=()
    local enabled_handlers=()

    # Split by comma
    IFS=',' read -ra targets <<< "$input"

    for target in "${targets[@]}"; do
        # Trim whitespace
        target=$(echo "$target" | xargs)
        local count=0
        local found=0

        for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
            [ -f "$file" ] || continue

            local id=$(get_workflow_id "$file")

            if [ "$target" = "all" ] || [ "$id" = "$target" ]; then
                found=1
                if ! is_workflow_enabled "$file"; then
                    sed -i 's/^enabled:\s*false/enabled: true/' "$file"
                    echo -e "${GREEN}✓${NC} Enabled: $id"
                    count=$((count + 1))
                    total_count=$((total_count + 1))

                    # With --force, enable required handlers
                    if [ $force -eq 1 ]; then
                        local action_types=$(get_workflow_action_types "$file")
                        for action_type in $action_types; do
                            local handler_name=$(map_action_to_handler "$action_type")
                            if [ -n "$handler_name" ]; then
                                # Check if not already processed
                                if [[ ! " ${enabled_handlers[*]} " =~ " ${handler_name} " ]]; then
                                    enable_handler_internal "$handler_name"
                                    enabled_handlers+=("$handler_name")
                                fi
                            fi
                        done
                    fi
                else
                    echo -e "${YELLOW}○${NC} Already enabled: $id"
                fi

                [ "$target" != "all" ] && break
            fi
        done

        if [ "$target" != "all" ] && [ $found -eq 0 ]; then
            not_found+=("$target")
        fi
    done

    # Report not found
    for nf in "${not_found[@]}"; do
        echo -e "${RED}✗${NC} Not found: $nf"
    done

    echo ""
    echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
    echo "  $0 restart"
}

# Disable workflow (supports comma-separated list)
workflow_disable() {
    local input="$1"

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing workflow ID${NC}"
        echo "Usage: $0 workflow disable <id|id1,id2,...|all>"
        exit 1
    fi

    local total_count=0
    local not_found=()

    # Split by comma
    IFS=',' read -ra targets <<< "$input"

    for target in "${targets[@]}"; do
        # Trim whitespace
        target=$(echo "$target" | xargs)
        local count=0
        local found=0

        for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
            [ -f "$file" ] || continue

            local id=$(get_workflow_id "$file")

            if [ "$target" = "all" ] || [ "$id" = "$target" ]; then
                found=1
                if is_workflow_enabled "$file"; then
                    sed -i 's/^enabled:\s*true/enabled: false/' "$file"
                    echo -e "${GREEN}✓${NC} Disabled: $id"
                    count=$((count + 1))
                    total_count=$((total_count + 1))
                else
                    echo -e "${YELLOW}○${NC} Already disabled: $id"
                fi

                [ "$target" != "all" ] && break
            fi
        done

        if [ "$target" != "all" ] && [ $found -eq 0 ]; then
            not_found+=("$target")
        fi
    done

    # Report not found
    for nf in "${not_found[@]}"; do
        echo -e "${RED}✗${NC} Not found: $nf"
    done

    echo ""
    echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
    echo "  $0 restart"
}

# Show workflow details
workflow_show() {
    local target="$1"

    if [ -z "$target" ]; then
        echo -e "${RED}Error: Missing workflow ID${NC}"
        echo "Usage: $0 workflow show <id>"
        exit 1
    fi

    for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
        [ -f "$file" ] || continue

        local id=$(get_workflow_id "$file")

        if [ "$id" = "$target" ]; then
            echo -e "${BLUE}Workflow: $id${NC}"
            echo -e "${BLUE}File: $file${NC}"
            echo ""
            cat "$file"
            return 0
        fi
    done

    echo -e "${RED}Error: Workflow '$target' not found${NC}"
    exit 1
}

# Refresh workflow from example (supports comma-separated list)
workflow_refresh() {
    local input="$1"

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing workflow ID${NC}"
        echo "Usage: $0 workflow refresh <id|id1,id2,...>"
        exit 1
    fi

    local refreshed=0
    local not_found=()

    # Split by comma
    IFS=',' read -ra targets <<< "$input"

    for target in "${targets[@]}"; do
        # Trim whitespace
        target=$(echo "$target" | xargs)
        local found_example=0

        # Look for example file with various extensions
        for ext in ".yml.example" ".yaml.example" ".yml" ".yaml"; do
            local example_file="$EXAMPLES_WORKFLOWS_DIR/${target}${ext}"
            if [ -f "$example_file" ]; then
                found_example=1

                # Determine target filename (remove .example if present)
                local target_name=$(basename "$example_file" | sed 's/\.example$//')
                local target_file="$WORKFLOWS_DIR/$target_name"

                # Remove existing deployed version
                if [ -f "$target_file" ]; then
                    rm "$target_file"
                    echo -e "${YELLOW}○${NC} Removed: $target_file"
                fi

                # Copy example to config
                cp "$example_file" "$target_file"
                echo -e "${GREEN}✓${NC} Refreshed: $target → $target_name"
                refreshed=$((refreshed + 1))
                break
            fi
        done

        if [ $found_example -eq 0 ]; then
            not_found+=("$target")
        fi
    done

    # Report not found
    for nf in "${not_found[@]}"; do
        echo -e "${RED}✗${NC} Example not found: $nf"
        echo "  Looked in: $EXAMPLES_WORKFLOWS_DIR/${nf}.yml.example"
    done

    if [ $refreshed -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
        echo "  $0 restart"
    fi
}

# Load missing workflows from examples
workflow_load_missing() {
    echo -e "${BLUE}Loading missing workflows from examples...${NC}"
    echo ""

    local loaded=0
    local skipped=0

    for example_file in "$EXAMPLES_WORKFLOWS_DIR"/*.yml.example "$EXAMPLES_WORKFLOWS_DIR"/*.yaml.example; do
        [ -f "$example_file" ] || continue

        # Get workflow ID from example file
        local id=$(get_workflow_id "$example_file")
        if [ -z "$id" ]; then
            id=$(basename "$example_file" | sed 's/\.ya\?ml\.example$//')
        fi

        # Determine target filename
        local target_name=$(basename "$example_file" | sed 's/\.example$//')
        local target_file="$WORKFLOWS_DIR/$target_name"

        # Check if already deployed
        if [ -f "$target_file" ]; then
            skipped=$((skipped + 1))
            continue
        fi

        # Copy example to config
        cp "$example_file" "$target_file"
        echo -e "${GREEN}✓${NC} Deployed: $id → $target_name"
        loaded=$((loaded + 1))
    done

    echo ""
    echo -e "Loaded: ${GREEN}$loaded${NC} | Already present: ${YELLOW}$skipped${NC}"

    if [ $loaded -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
        echo "  $0 restart"
    fi
}

# Get handler name from file (filename without extension)
get_handler_name() {
    local file="$1"
    basename "$file" | sed 's/\.ya\?ml$//'
}

# Check if handler is enabled
is_handler_enabled() {
    local file="$1"
    # Handler files have different structures, check for enabled: true at any level
    grep -E "^\s*enabled:\s*true" "$file" >/dev/null 2>&1
}

# List handlers
handler_list() {
    local filter="${1:-all}"

    echo -e "${BLUE}Handlers in $HANDLERS_DIR${NC}"
    echo ""
    printf "%-25s %s\n" "NAME" "STATUS"
    printf "%-25s %s\n" "-------------------------" "--------"

    for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
        [ -f "$file" ] || continue

        local name=$(get_handler_name "$file")
        local status

        if is_handler_enabled "$file"; then
            status="${GREEN}enabled${NC}"
            [ "$filter" = "disabled" ] && continue
        else
            status="${RED}disabled${NC}"
            [ "$filter" = "enabled" ] && continue
        fi

        printf "%-25s %b\n" "$name" "$status"
    done
}

# Enable handler (supports comma-separated list)
handler_enable() {
    local input="$1"

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing handler name${NC}"
        echo "Usage: $0 handler enable <name|name1,name2,...|all>"
        exit 1
    fi

    local total_count=0
    local not_found=()

    # Split by comma
    IFS=',' read -ra targets <<< "$input"

    for target in "${targets[@]}"; do
        # Trim whitespace
        target=$(echo "$target" | xargs)
        local count=0
        local found=0

        for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
            [ -f "$file" ] || continue

            local name=$(get_handler_name "$file")

            if [ "$target" = "all" ] || [ "$name" = "$target" ]; then
                found=1
                if ! is_handler_enabled "$file"; then
                    # Replace enabled: false with enabled: true (handles indentation)
                    sed -i 's/^\(\s*\)enabled:\s*false/\1enabled: true/' "$file"
                    echo -e "${GREEN}✓${NC} Enabled: $name"
                    count=$((count + 1))
                    total_count=$((total_count + 1))
                else
                    echo -e "${YELLOW}○${NC} Already enabled: $name"
                fi

                [ "$target" != "all" ] && break
            fi
        done

        if [ "$target" != "all" ] && [ $found -eq 0 ]; then
            not_found+=("$target")
        fi
    done

    # Report not found
    for nf in "${not_found[@]}"; do
        echo -e "${RED}✗${NC} Not found: $nf"
    done

    echo ""
    echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
    echo "  $0 restart"
}

# Disable handler (supports comma-separated list)
handler_disable() {
    local input="$1"

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing handler name${NC}"
        echo "Usage: $0 handler disable <name|name1,name2,...|all>"
        exit 1
    fi

    local total_count=0
    local not_found=()

    # Split by comma
    IFS=',' read -ra targets <<< "$input"

    for target in "${targets[@]}"; do
        # Trim whitespace
        target=$(echo "$target" | xargs)
        local count=0
        local found=0

        for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
            [ -f "$file" ] || continue

            local name=$(get_handler_name "$file")

            if [ "$target" = "all" ] || [ "$name" = "$target" ]; then
                found=1
                if is_handler_enabled "$file"; then
                    # Replace enabled: true with enabled: false (handles indentation)
                    sed -i 's/^\(\s*\)enabled:\s*true/\1enabled: false/' "$file"
                    echo -e "${GREEN}✓${NC} Disabled: $name"
                    count=$((count + 1))
                    total_count=$((total_count + 1))
                else
                    echo -e "${YELLOW}○${NC} Already disabled: $name"
                fi

                [ "$target" != "all" ] && break
            fi
        done

        if [ "$target" != "all" ] && [ $found -eq 0 ]; then
            not_found+=("$target")
        fi
    done

    # Report not found
    for nf in "${not_found[@]}"; do
        echo -e "${RED}✗${NC} Not found: $nf"
    done

    echo ""
    echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
    echo "  $0 restart"
}

# Show handler details
handler_show() {
    local target="$1"

    if [ -z "$target" ]; then
        echo -e "${RED}Error: Missing handler name${NC}"
        echo "Usage: $0 handler show <name>"
        exit 1
    fi

    for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
        [ -f "$file" ] || continue

        local name=$(get_handler_name "$file")

        if [ "$name" = "$target" ]; then
            echo -e "${BLUE}Handler: $name${NC}"
            echo -e "${BLUE}File: $file${NC}"
            echo ""
            cat "$file"
            return 0
        fi
    done

    echo -e "${RED}Error: Handler '$target' not found${NC}"
    exit 1
}

# Refresh handler from example (supports comma-separated list)
handler_refresh() {
    local input="$1"

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing handler name${NC}"
        echo "Usage: $0 handler refresh <name|name1,name2,...>"
        exit 1
    fi

    local refreshed=0
    local not_found=()

    # Split by comma
    IFS=',' read -ra targets <<< "$input"

    for target in "${targets[@]}"; do
        # Trim whitespace
        target=$(echo "$target" | xargs)
        local found_example=0

        # Look for example file in config/handlers/
        local example_file="$HANDLERS_DIR/${target}.yml.example"
        if [ -f "$example_file" ]; then
            found_example=1
            local target_file="$HANDLERS_DIR/${target}.yml"

            # Remove existing deployed version
            if [ -f "$target_file" ]; then
                rm "$target_file"
                echo -e "${YELLOW}○${NC} Removed: $target_file"
            fi

            # Copy example
            cp "$example_file" "$target_file"
            echo -e "${GREEN}✓${NC} Refreshed: $target"
            refreshed=$((refreshed + 1))
        fi

        if [ $found_example -eq 0 ]; then
            not_found+=("$target")
        fi
    done

    # Report not found
    for nf in "${not_found[@]}"; do
        echo -e "${RED}✗${NC} Example not found: $nf"
        echo "  Looked for: $HANDLERS_DIR/${nf}.yml.example"
    done

    if [ $refreshed -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
        echo "  $0 restart"
    fi
}

# Load missing handlers from examples
handler_load_missing() {
    echo -e "${BLUE}Loading missing handlers from examples...${NC}"
    echo ""

    local loaded=0
    local skipped=0

    for example_file in "$HANDLERS_DIR"/*.yml.example; do
        [ -f "$example_file" ] || continue

        # Get handler name from example file
        local name=$(basename "$example_file" | sed 's/\.yml\.example$//')
        local target_file="$HANDLERS_DIR/${name}.yml"

        # Check if already deployed
        if [ -f "$target_file" ]; then
            skipped=$((skipped + 1))
            continue
        fi

        # Copy example
        cp "$example_file" "$target_file"
        echo -e "${GREEN}✓${NC} Deployed: $name"
        loaded=$((loaded + 1))
    done

    echo ""
    echo -e "Loaded: ${GREEN}$loaded${NC} | Already present: ${YELLOW}$skipped${NC}"

    if [ $loaded -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
        echo "  $0 restart"
    fi
}

# Show status
show_status() {
    echo -e "${BLUE}PipeliNostr Status${NC}"
    echo ""

    # Check if process is running
    if pgrep -f "node dist/index.js" > /dev/null; then
        local pid=$(pgrep -f "node dist/index.js")
        echo -e "Service: ${GREEN}Running${NC} (PID: $pid)"
    else
        echo -e "Service: ${RED}Stopped${NC}"
    fi

    # Count workflows
    local wf_total=0
    local wf_enabled=0

    for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
        [ -f "$file" ] || continue
        wf_total=$((wf_total + 1))
        is_workflow_enabled "$file" && wf_enabled=$((wf_enabled + 1))
    done

    echo "Workflows: $wf_enabled enabled / $wf_total total"

    # Count handlers
    local h_total=0
    local h_enabled=0

    for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
        [ -f "$file" ] || continue
        h_total=$((h_total + 1))
        is_handler_enabled "$file" && h_enabled=$((h_enabled + 1))
    done

    echo "Handlers: $h_enabled enabled / $h_total total"

    # Show log file size
    local log_file="$PROJECT_DIR/logs/pipelinostr.log"
    if [ -f "$log_file" ]; then
        local size=$(du -h "$log_file" | cut -f1)
        echo "Log file: $size"
    fi
}

# Restart service
do_restart() {
    echo "Restarting PipeliNostr..."
    "$SCRIPT_DIR/restart.sh"
}

# Show logs
show_logs() {
    local lines="${1:-50}"
    local log_file="$PROJECT_DIR/logs/pipelinostr.log"

    if [ -f "$log_file" ]; then
        tail -n "$lines" "$log_file"
    else
        echo -e "${RED}Log file not found: $log_file${NC}"
        exit 1
    fi
}

# ============================================
# Relay Management (via SQLite database)
# ============================================

DB_PATH="$PROJECT_DIR/data/pipelinostr.db"

# List relays from database
relay_list() {
    if [ ! -f "$DB_PATH" ]; then
        echo -e "${RED}Database not found: $DB_PATH${NC}"
        echo "Is PipeliNostr running?"
        exit 1
    fi

    echo -e "${BLUE}Relays in database${NC}"
    echo ""
    printf "%-45s %-12s %-10s %s\n" "URL" "STATUS" "FAILURES" "SOURCE"
    printf "%-45s %-12s %-10s %s\n" "---------------------------------------------" "------------" "----------" "----------"

    sqlite3 -separator '|' "$DB_PATH" "SELECT url, status, consecutive_failures, discovered_from FROM relay_state ORDER BY status, url;" 2>/dev/null | while IFS='|' read -r url status failures source; do
        case "$status" in
            active)
                status_color="${GREEN}active${NC}"
                ;;
            quarantined)
                status_color="${YELLOW}quarantined${NC}"
                ;;
            abandoned)
                status_color="${RED}abandoned${NC}"
                ;;
            *)
                status_color="$status"
                ;;
        esac
        printf "%-45s %b %-10s %s\n" "${url:0:45}" "$status_color" "$failures" "$source"
    done

    echo ""
    # Show stats
    local total=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM relay_state;" 2>/dev/null)
    local active=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM relay_state WHERE status='active';" 2>/dev/null)
    local quarantined=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM relay_state WHERE status='quarantined';" 2>/dev/null)
    echo -e "Total: $total | Active: ${GREEN}$active${NC} | Quarantined: ${YELLOW}$quarantined${NC}"
}

# Add a relay to database
relay_add() {
    local url="$1"

    if [ -z "$url" ]; then
        echo -e "${RED}Error: Missing relay URL${NC}"
        echo "Usage: $0 relay add <wss://...>"
        exit 1
    fi

    if [[ ! "$url" =~ ^wss?:// ]]; then
        echo -e "${RED}Error: Invalid relay URL (must start with wss:// or ws://)${NC}"
        exit 1
    fi

    if [ ! -f "$DB_PATH" ]; then
        echo -e "${RED}Database not found: $DB_PATH${NC}"
        exit 1
    fi

    # Check if already exists
    local existing=$(sqlite3 "$DB_PATH" "SELECT url FROM relay_state WHERE url='$url';" 2>/dev/null)
    if [ -n "$existing" ]; then
        echo -e "${YELLOW}Relay already exists: $url${NC}"
        exit 0
    fi

    # Insert new relay
    local now=$(date -u +"%Y-%m-%d %H:%M:%S")
    sqlite3 "$DB_PATH" "INSERT INTO relay_state (url, status, consecutive_failures, quarantine_level, total_events_received, total_events_sent, discovered_from, first_seen_at, updated_at) VALUES ('$url', 'active', 0, 0, 0, 0, 'config', '$now', '$now');" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} Added relay: $url"
        echo ""
        echo -e "${YELLOW}Note: Restart PipeliNostr to connect to this relay${NC}"
        echo "  $0 restart"
    else
        echo -e "${RED}Failed to add relay${NC}"
        exit 1
    fi
}

# Remove a relay from database
relay_remove() {
    local url="$1"

    if [ -z "$url" ]; then
        echo -e "${RED}Error: Missing relay URL${NC}"
        echo "Usage: $0 relay remove <wss://...>"
        exit 1
    fi

    if [ ! -f "$DB_PATH" ]; then
        echo -e "${RED}Database not found: $DB_PATH${NC}"
        exit 1
    fi

    # Check if exists
    local existing=$(sqlite3 "$DB_PATH" "SELECT url FROM relay_state WHERE url='$url';" 2>/dev/null)
    if [ -z "$existing" ]; then
        echo -e "${YELLOW}Relay not found: $url${NC}"
        exit 0
    fi

    # Delete relay
    sqlite3 "$DB_PATH" "DELETE FROM relay_state WHERE url='$url';" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} Removed relay: $url"
        echo ""
        echo -e "${YELLOW}Note: Restart PipeliNostr to disconnect from this relay${NC}"
        echo "  $0 restart"
    else
        echo -e "${RED}Failed to remove relay${NC}"
        exit 1
    fi
}

# Manage relay blacklist in config.yml
relay_blacklist() {
    local arg="$1"
    local config_file="$PROJECT_DIR/config/config.yml"

    if [ -z "$arg" ]; then
        # Show current blacklist
        echo -e "${BLUE}Current blacklist:${NC}"
        grep -A 100 "^relays:" "$config_file" 2>/dev/null | grep -A 50 "blacklist:" | grep "^\s*-" | sed 's/^\s*-\s*/  /' || echo "  (empty)"
        exit 0
    fi

    if [ ! -f "$config_file" ]; then
        echo -e "${RED}Config file not found: $config_file${NC}"
        exit 1
    fi

    local action="${arg:0:1}"
    local url="${arg:1}"

    if [[ "$action" != "+" && "$action" != "-" ]]; then
        echo -e "${RED}Error: Use +wss://... to add or -wss://... to remove${NC}"
        echo "Usage: $0 relay blacklist [+|-]<wss://...>"
        exit 1
    fi

    if [[ ! "$url" =~ ^wss?:// ]]; then
        echo -e "${RED}Error: Invalid relay URL (must start with wss:// or ws://)${NC}"
        exit 1
    fi

    if [ "$action" = "+" ]; then
        # Add to blacklist
        # Check if blacklist line exists and is empty array
        if grep -q "blacklist: \[\]" "$config_file"; then
            # Replace empty array with the URL
            sed -i "s|blacklist: \[\]|blacklist:\n    - \"$url\"|" "$config_file"
        elif grep -q "blacklist:" "$config_file"; then
            # Add to existing blacklist (after blacklist: line)
            sed -i "/^\s*blacklist:/a\\    - \"$url\"" "$config_file"
        else
            echo -e "${RED}Could not find blacklist section in config${NC}"
            exit 1
        fi
        echo -e "${GREEN}✓${NC} Added to blacklist: $url"
    else
        # Remove from blacklist
        sed -i "/^\s*-\s*[\"']$url[\"']/d" "$config_file"
        echo -e "${GREEN}✓${NC} Removed from blacklist: $url"
    fi

    echo ""
    echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
    echo "  $0 restart"
}

# Main
case "${1:-}" in
    workflow)
        case "${2:-}" in
            list)
                workflow_list "${3:-all}"
                ;;
            enable)
                workflow_enable "$3" "$4"
                ;;
            disable)
                workflow_disable "$3"
                ;;
            show)
                workflow_show "$3"
                ;;
            refresh)
                workflow_refresh "$3"
                ;;
            load-missing)
                workflow_load_missing
                ;;
            *)
                echo -e "${RED}Unknown workflow command: ${2:-}${NC}"
                echo "Use: $0 workflow [list|enable|disable|show|refresh|load-missing]"
                exit 1
                ;;
        esac
        ;;
    handler)
        case "${2:-}" in
            list)
                handler_list "${3:-all}"
                ;;
            enable)
                handler_enable "$3"
                ;;
            disable)
                handler_disable "$3"
                ;;
            show)
                handler_show "$3"
                ;;
            refresh)
                handler_refresh "$3"
                ;;
            load-missing)
                handler_load_missing
                ;;
            *)
                echo -e "${RED}Unknown handler command: ${2:-}${NC}"
                echo "Use: $0 handler [list|enable|disable|show|refresh|load-missing]"
                exit 1
                ;;
        esac
        ;;
    relay)
        case "${2:-}" in
            list)
                relay_list
                ;;
            add)
                relay_add "$3"
                ;;
            remove)
                relay_remove "$3"
                ;;
            blacklist)
                relay_blacklist "$3"
                ;;
            *)
                echo -e "${RED}Unknown relay command: ${2:-}${NC}"
                echo "Use: $0 relay [list|add|remove|blacklist]"
                exit 1
                ;;
        esac
        ;;
    status)
        show_status
        ;;
    restart)
        do_restart
        ;;
    logs)
        show_logs "${2:-50}"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac
