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
    echo "  workflow enable [--force] <id|pattern|all>  Enable workflow(s), supports wildcards"
    echo "  workflow disable <id|pattern|all>          Disable workflow(s), supports wildcards"
    echo "  workflow show <id>                         Show workflow details"
    echo "  workflow refresh <id|pattern|id1,id2,...>  Refresh from example, supports wildcards"
    echo "  workflow load-missing                 Deploy missing workflows from examples"
    echo "  workflow clean [--purge]              Archive workflows without examples (.old)"
    echo ""
    echo "  handler list [all|enabled|disabled]        List handlers (default: all)"
    echo "  handler enable <name|pattern|all>          Enable handler(s), supports wildcards"
    echo "  handler disable <name|pattern|all>         Disable handler(s), supports wildcards"
    echo "  handler show <name>                        Show handler config"
    echo "  handler refresh <name|pattern|n1,n2,...>   Refresh from example, supports wildcards"
    echo "  handler load-missing                  Deploy missing handlers from examples"
    echo "  handler clean [--purge]               Archive handlers without examples (.old)"
    echo ""
    echo "  relay list                            List all relays from database"
    echo "  relay add <wss://...>                 Add a relay"
    echo "  relay remove <wss://...>              Remove a relay"
    echo "  relay blacklist [+|-]<wss://...>      Add (+) or remove (-) from blacklist"
    echo "  relay clean                           Remove relays not in config.yml"
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
    echo "  $0 workflow clean"
    echo "  $0 workflow clean --purge"
    echo "  $0 handler list"
    echo "  $0 handler enable email"
    echo "  $0 handler disable traccar-sms,discord,twitter"
    echo "  $0 handler refresh telegram,email"
    echo "  $0 handler load-missing"
    echo "  $0 handler clean --purge"
    echo "  $0 relay list"
    echo "  $0 relay add wss://relay.example.com"
    echo "  $0 relay blacklist +wss://spam.relay.com"
    echo "  $0 relay blacklist -wss://spam.relay.com"
    echo "  $0 relay clean"
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

# Check if ID matches pattern (supports wildcards * and ?)
matches_pattern() {
    local id="$1"
    local pattern="$2"

    # "all" matches everything
    [ "$pattern" = "all" ] && return 0

    # Exact match
    [ "$id" = "$pattern" ] && return 0

    # Wildcard match using bash extended globbing
    [[ "$id" == $pattern ]] && return 0

    return 1
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
        echo "Usage: $0 workflow enable [--force] <id|pattern|id1,id2,...|all>"
        echo "Patterns support wildcards: claudeDM-* matches all claudeDM workflows"
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

            if matches_pattern "$id" "$target"; then
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

                # Only break for exact matches (no wildcards)
                [[ "$target" != "all" && "$target" != *"*"* && "$target" != *"?"* ]] && break
            fi
        done

        # Only report not found for exact matches (no wildcards)
        if [[ "$target" != "all" && "$target" != *"*"* && "$target" != *"?"* ]] && [ $found -eq 0 ]; then
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

# Disable workflow (supports comma-separated list and wildcards)
workflow_disable() {
    local input="$1"

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing workflow ID${NC}"
        echo "Usage: $0 workflow disable <id|pattern|id1,id2,...|all>"
        echo "Patterns support wildcards: claudeDM-* matches all claudeDM workflows"
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

            if matches_pattern "$id" "$target"; then
                found=1
                if is_workflow_enabled "$file"; then
                    sed -i 's/^enabled:\s*true/enabled: false/' "$file"
                    echo -e "${GREEN}✓${NC} Disabled: $id"
                    count=$((count + 1))
                    total_count=$((total_count + 1))
                else
                    echo -e "${YELLOW}○${NC} Already disabled: $id"
                fi

                # Only break for exact matches (no wildcards)
                [[ "$target" != "all" && "$target" != *"*"* && "$target" != *"?"* ]] && break
            fi
        done

        # Only report not found for exact matches (no wildcards)
        if [[ "$target" != "all" && "$target" != *"*"* && "$target" != *"?"* ]] && [ $found -eq 0 ]; then
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
        echo "Usage: $0 workflow refresh <id|pattern|id1,id2,...>"
        echo "Patterns support wildcards: claudeDM-* matches all claudeDM workflows"
        exit 1
    fi

    local refreshed=0
    local not_found=()

    # Split by comma
    IFS=',' read -ra targets <<< "$input"

    for target in "${targets[@]}"; do
        # Trim whitespace
        target=$(echo "$target" | xargs)
        local found_any=0

        # Check if target contains wildcards
        if [[ "$target" == *"*"* || "$target" == *"?"* ]]; then
            # Wildcard mode: scan all example files
            for example_file in "$EXAMPLES_WORKFLOWS_DIR"/*.yml.example "$EXAMPLES_WORKFLOWS_DIR"/*.yaml.example "$EXAMPLES_WORKFLOWS_DIR"/*.yml "$EXAMPLES_WORKFLOWS_DIR"/*.yaml; do
                [ -f "$example_file" ] || continue

                # Extract ID from filename
                local filename=$(basename "$example_file")
                local id="${filename%.yml.example}"
                id="${id%.yaml.example}"
                id="${id%.yml}"
                id="${id%.yaml}"

                if matches_pattern "$id" "$target"; then
                    found_any=1

                    # Determine target filename (remove .example if present)
                    local target_name=$(basename "$example_file" | sed 's/\.example$//')
                    local target_file="$WORKFLOWS_DIR/$target_name"

                    # Remove existing deployed version
                    if [ -f "$target_file" ]; then
                        rm "$target_file"
                    fi

                    # Copy example to config and disable by default
                    cp "$example_file" "$target_file"
                    sed -i 's/^\(\s*\)enabled:\s*true/\1enabled: false/' "$target_file"
                    echo -e "${GREEN}✓${NC} Refreshed (disabled): $id → $target_name"
                    refreshed=$((refreshed + 1))
                fi
            done
        else
            # Exact match mode: look for specific example file
            for ext in ".yml.example" ".yaml.example" ".yml" ".yaml"; do
                local example_file="$EXAMPLES_WORKFLOWS_DIR/${target}${ext}"
                if [ -f "$example_file" ]; then
                    found_any=1

                    # Determine target filename (remove .example if present)
                    local target_name=$(basename "$example_file" | sed 's/\.example$//')
                    local target_file="$WORKFLOWS_DIR/$target_name"

                    # Remove existing deployed version
                    if [ -f "$target_file" ]; then
                        rm "$target_file"
                    fi

                    # Copy example to config and disable by default
                    cp "$example_file" "$target_file"
                    sed -i 's/^\(\s*\)enabled:\s*true/\1enabled: false/' "$target_file"
                    echo -e "${GREEN}✓${NC} Refreshed (disabled): $target → $target_name"
                    refreshed=$((refreshed + 1))
                    break
                fi
            done

            if [ $found_any -eq 0 ]; then
                not_found+=("$target")
            fi
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

# Load missing workflows from examples (disabled by default)
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

        # Copy example to config and disable it
        cp "$example_file" "$target_file"
        sed -i 's/^enabled:\s*true/enabled: false/' "$target_file"
        echo -e "${GREEN}✓${NC} Deployed (disabled): $id → $target_name"
        loaded=$((loaded + 1))
    done

    echo ""
    echo -e "Loaded: ${GREEN}$loaded${NC} | Already present: ${YELLOW}$skipped${NC}"

    if [ $loaded -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}Workflows are disabled by default. Enable with:${NC}"
        echo "  $0 workflow enable <id>"
    fi
}

# Clean workflows without examples (rename to .old, optionally purge)
workflow_clean() {
    local purge=0
    [ "$1" = "--purge" ] && purge=1

    echo -e "${BLUE}Cleaning workflows without examples...${NC}"
    echo ""

    local archived=0
    local purged=0

    for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
        [ -f "$file" ] || continue
        # Skip .old files
        [[ "$file" == *.old ]] && continue

        local basename_file=$(basename "$file")
        # Get filename without extension for example lookup
        local name_no_ext=$(echo "$basename_file" | sed 's/\.ya\?ml$//')
        local id=$(get_workflow_id "$file")
        [ -z "$id" ] && id="$name_no_ext"

        # Check if example exists BY FILENAME (not by ID)
        local has_example=0
        for ext in ".yml.example" ".yaml.example" ".yml" ".yaml"; do
            if [ -f "$EXAMPLES_WORKFLOWS_DIR/${name_no_ext}${ext}" ]; then
                has_example=1
                break
            fi
        done

        if [ $has_example -eq 0 ]; then
            mv "$file" "${file}.old"
            echo -e "${YELLOW}○${NC} Archived: $id ($basename_file) → ${basename_file}.old"
            archived=$((archived + 1))
        fi
    done

    # Purge .old files if requested
    if [ $purge -eq 1 ]; then
        for old_file in "$WORKFLOWS_DIR"/*.old; do
            [ -f "$old_file" ] || continue
            rm "$old_file"
            echo -e "${RED}✗${NC} Purged: $(basename "$old_file")"
            purged=$((purged + 1))
        done
    fi

    echo ""
    echo -e "Archived: ${YELLOW}$archived${NC}"
    [ $purge -eq 1 ] && echo -e "Purged: ${RED}$purged${NC}"

    if [ $archived -gt 0 ] && [ $purge -eq 0 ]; then
        echo ""
        echo -e "${YELLOW}Use --purge to delete .old files${NC}"
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

# Check if handler has missing environment variables
check_handler_env_vars() {
    local file="$1"
    local env_file="$PROJECT_DIR/.env"
    local missing=""

    # Extract ${VAR_NAME} patterns from the file
    local vars=$(grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' "$file" 2>/dev/null | sort -u)

    for var in $vars; do
        # Extract variable name (remove ${ and })
        local var_name=$(echo "$var" | sed 's/\${\([^}]*\)}/\1/')

        # Check if defined in .env file
        if [ -f "$env_file" ]; then
            if ! grep -qE "^${var_name}=" "$env_file" 2>/dev/null; then
                missing="${missing}${var_name} "
            fi
        else
            missing="${missing}${var_name} "
        fi
    done

    echo "$missing"
}

# List handlers
handler_list() {
    local filter="${1:-all}"

    echo -e "${BLUE}Handlers in $HANDLERS_DIR${NC}"
    echo ""
    printf "%-25s %-20s %s\n" "NAME" "STATUS" "ISSUE"
    printf "%-25s %-20s %s\n" "-------------------------" "--------------------" "-----"

    for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
        [ -f "$file" ] || continue

        local name=$(get_handler_name "$file")
        local status
        local issue=""

        if is_handler_enabled "$file"; then
            # Check for missing env vars
            local missing_vars=$(check_handler_env_vars "$file")
            if [ -n "$missing_vars" ]; then
                status="${YELLOW}misconfigured${NC}"
                issue="missing: $missing_vars"
                [ "$filter" = "disabled" ] && continue
            else
                status="${GREEN}enabled${NC}"
                [ "$filter" = "disabled" ] && continue
            fi
        else
            status="${RED}disabled${NC}"
            [ "$filter" = "enabled" ] && continue
        fi

        printf "%-25s %b %s\n" "$name" "$status" "$issue"
    done
}

# Enable handler (supports comma-separated list)
handler_enable() {
    local input="$1"

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing handler name${NC}"
        echo "Usage: $0 handler enable <name|pattern|name1,name2,...|all>"
        echo "Patterns support wildcards: nostr_* matches all nostr handlers"
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

            if matches_pattern "$name" "$target"; then
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

                # Only break for exact matches (no wildcards)
                [[ "$target" != "all" && "$target" != *"*"* && "$target" != *"?"* ]] && break
            fi
        done

        # Only report not found for exact matches (no wildcards)
        if [[ "$target" != "all" && "$target" != *"*"* && "$target" != *"?"* ]] && [ $found -eq 0 ]; then
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

# Disable handler (supports comma-separated list and wildcards)
handler_disable() {
    local input="$1"

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing handler name${NC}"
        echo "Usage: $0 handler disable <name|pattern|name1,name2,...|all>"
        echo "Patterns support wildcards: nostr_* matches all nostr handlers"
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

            if matches_pattern "$name" "$target"; then
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

                # Only break for exact matches (no wildcards)
                [[ "$target" != "all" && "$target" != *"*"* && "$target" != *"?"* ]] && break
            fi
        done

        # Only report not found for exact matches (no wildcards)
        if [[ "$target" != "all" && "$target" != *"*"* && "$target" != *"?"* ]] && [ $found -eq 0 ]; then
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

# Refresh handler from example (supports comma-separated list and wildcards)
handler_refresh() {
    local input="$1"

    if [ -z "$input" ]; then
        echo -e "${RED}Error: Missing handler name${NC}"
        echo "Usage: $0 handler refresh <name|pattern|name1,name2,...>"
        echo "Patterns support wildcards: nostr_* matches all nostr handlers"
        exit 1
    fi

    local refreshed=0
    local not_found=()

    # Split by comma
    IFS=',' read -ra targets <<< "$input"

    for target in "${targets[@]}"; do
        # Trim whitespace
        target=$(echo "$target" | xargs)
        local found_any=0

        # Check if target contains wildcards
        if [[ "$target" == *"*"* || "$target" == *"?"* ]]; then
            # Wildcard mode: scan all example files
            for example_file in "$HANDLERS_DIR"/*.yml.example; do
                [ -f "$example_file" ] || continue

                # Extract name from filename
                local filename=$(basename "$example_file")
                local name="${filename%.yml.example}"

                if matches_pattern "$name" "$target"; then
                    found_any=1
                    local target_file="$HANDLERS_DIR/${name}.yml"

                    # Remove existing deployed version
                    if [ -f "$target_file" ]; then
                        rm "$target_file"
                    fi

                    # Copy example and disable by default
                    cp "$example_file" "$target_file"
                    sed -i 's/^\(\s*\)enabled:\s*true/\1enabled: false/' "$target_file"
                    echo -e "${GREEN}✓${NC} Refreshed (disabled): $name"
                    refreshed=$((refreshed + 1))
                fi
            done
        else
            # Exact match mode: look for specific example file
            local example_file="$HANDLERS_DIR/${target}.yml.example"
            if [ -f "$example_file" ]; then
                found_any=1
                local target_file="$HANDLERS_DIR/${target}.yml"

                # Remove existing deployed version
                if [ -f "$target_file" ]; then
                    rm "$target_file"
                fi

                # Copy example and disable by default
                cp "$example_file" "$target_file"
                sed -i 's/^\(\s*\)enabled:\s*true/\1enabled: false/' "$target_file"
                echo -e "${GREEN}✓${NC} Refreshed (disabled): $target"
                refreshed=$((refreshed + 1))
            fi

            if [ $found_any -eq 0 ]; then
                not_found+=("$target")
            fi
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

# Load missing handlers from examples (disabled by default)
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

        # Copy example and disable it
        cp "$example_file" "$target_file"
        sed -i 's/^\(\s*\)enabled:\s*true/\1enabled: false/' "$target_file"
        echo -e "${GREEN}✓${NC} Deployed (disabled): $name"
        loaded=$((loaded + 1))
    done

    echo ""
    echo -e "Loaded: ${GREEN}$loaded${NC} | Already present: ${YELLOW}$skipped${NC}"

    if [ $loaded -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}Handlers are disabled by default. Enable with:${NC}"
        echo "  $0 handler enable <name>"
    fi
}

# Clean handlers without examples (rename to .old, optionally purge)
handler_clean() {
    local purge=0
    [ "$1" = "--purge" ] && purge=1

    echo -e "${BLUE}Cleaning handlers without examples...${NC}"
    echo ""

    local archived=0
    local purged=0

    for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
        [ -f "$file" ] || continue
        # Skip .old and .example files
        [[ "$file" == *.old ]] && continue
        [[ "$file" == *.example ]] && continue

        local name=$(get_handler_name "$file")

        # Check if example exists
        local example_file="$HANDLERS_DIR/${name}.yml.example"
        if [ ! -f "$example_file" ]; then
            mv "$file" "${file}.old"
            echo -e "${YELLOW}○${NC} Archived: $name → ${name}.yml.old"
            archived=$((archived + 1))
        fi
    done

    # Purge .old files if requested
    if [ $purge -eq 1 ]; then
        for old_file in "$HANDLERS_DIR"/*.old; do
            [ -f "$old_file" ] || continue
            rm "$old_file"
            echo -e "${RED}✗${NC} Purged: $(basename "$old_file")"
            purged=$((purged + 1))
        done
    fi

    echo ""
    echo -e "Archived: ${YELLOW}$archived${NC}"
    [ $purge -eq 1 ] && echo -e "Purged: ${RED}$purged${NC}"

    if [ $archived -gt 0 ] && [ $purge -eq 0 ]; then
        echo ""
        echo -e "${YELLOW}Use --purge to delete .old files${NC}"
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

# Clean relays not in config.yml (sync DB with config)
relay_clean() {
    local config_file="$PROJECT_DIR/config/config.yml"

    if [ ! -f "$DB_PATH" ]; then
        echo -e "${RED}Database not found: $DB_PATH${NC}"
        echo "Is PipeliNostr running?"
        exit 1
    fi

    if [ ! -f "$config_file" ]; then
        echo -e "${RED}Config file not found: $config_file${NC}"
        exit 1
    fi

    echo -e "${BLUE}Syncing relays with config.yml...${NC}"
    echo ""

    # Extract primary relays from config.yml
    # Look for lines with wss:// or ws:// under relays.primary section
    local config_relays=$(grep -E '^\s*-\s*"?wss?://' "$config_file" | sed 's/^\s*-\s*"\?\([^"]*\)"\?/\1/' | tr -d ' ')

    if [ -z "$config_relays" ]; then
        echo -e "${YELLOW}Warning: No relays found in config.yml${NC}"
        echo "Expected format:"
        echo "  relays:"
        echo "    primary:"
        echo "      - \"wss://relay.example.com\""
        exit 1
    fi

    # Get all relay URLs from database
    local db_relays=$(sqlite3 "$DB_PATH" "SELECT url FROM relay_state;" 2>/dev/null)

    local removed=0
    local kept=0

    # For each relay in DB, check if it's in config
    while IFS= read -r db_url; do
        [ -z "$db_url" ] && continue

        local in_config=0
        while IFS= read -r config_url; do
            [ -z "$config_url" ] && continue
            if [ "$db_url" = "$config_url" ]; then
                in_config=1
                break
            fi
        done <<< "$config_relays"

        if [ $in_config -eq 0 ]; then
            # Relay not in config, remove it
            sqlite3 "$DB_PATH" "DELETE FROM relay_state WHERE url='$db_url';" 2>/dev/null
            echo -e "${RED}✗${NC} Removed: $db_url"
            removed=$((removed + 1))
        else
            kept=$((kept + 1))
        fi
    done <<< "$db_relays"

    echo ""
    echo -e "Kept: ${GREEN}$kept${NC} | Removed: ${RED}$removed${NC}"

    if [ $removed -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
        echo "  $0 restart"
    else
        echo ""
        echo -e "${GREEN}Database already in sync with config.yml${NC}"
    fi
}

# Main
case "${1:-}" in
    workflow)
        case "${2:-}" in
            list)
                workflow_list "${3:-all}"
                ;;
            enable)
                workflow_enable "${@:3}"
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
            clean)
                workflow_clean "$3"
                ;;
            *)
                echo -e "${RED}Unknown workflow command: ${2:-}${NC}"
                echo "Use: $0 workflow [list|enable|disable|show|refresh|load-missing|clean]"
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
            clean)
                handler_clean "$3"
                ;;
            *)
                echo -e "${RED}Unknown handler command: ${2:-}${NC}"
                echo "Use: $0 handler [list|enable|disable|show|refresh|load-missing|clean]"
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
            clean)
                relay_clean
                ;;
            *)
                echo -e "${RED}Unknown relay command: ${2:-}${NC}"
                echo "Use: $0 relay [list|add|remove|blacklist|clean]"
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
