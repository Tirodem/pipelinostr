#!/bin/bash
# PipeliNostr CLI - Manage workflows and service

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORKFLOWS_DIR="$PROJECT_DIR/config/workflows"
HANDLERS_DIR="$PROJECT_DIR/config/handlers"

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
    echo "  workflow enable <id|all>              Enable workflow(s)"
    echo "  workflow disable <id|all>             Disable workflow(s)"
    echo "  workflow show <id>                    Show workflow details"
    echo ""
    echo "  handler list [all|enabled|disabled]   List handlers (default: all)"
    echo "  handler enable <name|all>             Enable handler(s)"
    echo "  handler disable <name|all>            Disable handler(s)"
    echo "  handler show <name>                   Show handler config"
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
    echo "  $0 workflow disable all"
    echo "  $0 handler list"
    echo "  $0 handler enable email"
    echo "  $0 handler disable traccar-sms"
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

# Enable workflow
workflow_enable() {
    local target="$1"

    if [ -z "$target" ]; then
        echo -e "${RED}Error: Missing workflow ID${NC}"
        echo "Usage: $0 workflow enable <id|all>"
        exit 1
    fi

    local count=0

    for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
        [ -f "$file" ] || continue

        local id=$(get_workflow_id "$file")

        if [ "$target" = "all" ] || [ "$id" = "$target" ]; then
            if ! is_workflow_enabled "$file"; then
                sed -i 's/^enabled:\s*false/enabled: true/' "$file"
                echo -e "${GREEN}✓${NC} Enabled: $id"
                ((count++))
            else
                echo -e "${YELLOW}○${NC} Already enabled: $id"
            fi

            [ "$target" != "all" ] && break
        fi
    done

    if [ "$target" != "all" ] && [ $count -eq 0 ]; then
        # Check if we found the workflow at all
        local found=0
        for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
            [ -f "$file" ] || continue
            local id=$(get_workflow_id "$file")
            [ "$id" = "$target" ] && found=1 && break
        done

        if [ $found -eq 0 ]; then
            echo -e "${RED}Error: Workflow '$target' not found${NC}"
            exit 1
        fi
    fi

    echo ""
    echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
    echo "  $0 restart"
}

# Disable workflow
workflow_disable() {
    local target="$1"

    if [ -z "$target" ]; then
        echo -e "${RED}Error: Missing workflow ID${NC}"
        echo "Usage: $0 workflow disable <id|all>"
        exit 1
    fi

    local count=0

    for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
        [ -f "$file" ] || continue

        local id=$(get_workflow_id "$file")

        if [ "$target" = "all" ] || [ "$id" = "$target" ]; then
            if is_workflow_enabled "$file"; then
                sed -i 's/^enabled:\s*true/enabled: false/' "$file"
                echo -e "${GREEN}✓${NC} Disabled: $id"
                ((count++))
            else
                echo -e "${YELLOW}○${NC} Already disabled: $id"
            fi

            [ "$target" != "all" ] && break
        fi
    done

    if [ "$target" != "all" ] && [ $count -eq 0 ]; then
        # Check if we found the workflow at all
        local found=0
        for file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
            [ -f "$file" ] || continue
            local id=$(get_workflow_id "$file")
            [ "$id" = "$target" ] && found=1 && break
        done

        if [ $found -eq 0 ]; then
            echo -e "${RED}Error: Workflow '$target' not found${NC}"
            exit 1
        fi
    fi

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

# Enable handler
handler_enable() {
    local target="$1"

    if [ -z "$target" ]; then
        echo -e "${RED}Error: Missing handler name${NC}"
        echo "Usage: $0 handler enable <name|all>"
        exit 1
    fi

    local count=0

    for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
        [ -f "$file" ] || continue

        local name=$(get_handler_name "$file")

        if [ "$target" = "all" ] || [ "$name" = "$target" ]; then
            if ! is_handler_enabled "$file"; then
                # Replace enabled: false with enabled: true (handles indentation)
                sed -i 's/^\(\s*\)enabled:\s*false/\1enabled: true/' "$file"
                echo -e "${GREEN}✓${NC} Enabled: $name"
                ((count++))
            else
                echo -e "${YELLOW}○${NC} Already enabled: $name"
            fi

            [ "$target" != "all" ] && break
        fi
    done

    if [ "$target" != "all" ] && [ $count -eq 0 ]; then
        local found=0
        for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
            [ -f "$file" ] || continue
            local name=$(get_handler_name "$file")
            [ "$name" = "$target" ] && found=1 && break
        done

        if [ $found -eq 0 ]; then
            echo -e "${RED}Error: Handler '$target' not found${NC}"
            exit 1
        fi
    fi

    echo ""
    echo -e "${YELLOW}Note: Restart PipeliNostr to apply changes${NC}"
    echo "  $0 restart"
}

# Disable handler
handler_disable() {
    local target="$1"

    if [ -z "$target" ]; then
        echo -e "${RED}Error: Missing handler name${NC}"
        echo "Usage: $0 handler disable <name|all>"
        exit 1
    fi

    local count=0

    for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
        [ -f "$file" ] || continue

        local name=$(get_handler_name "$file")

        if [ "$target" = "all" ] || [ "$name" = "$target" ]; then
            if is_handler_enabled "$file"; then
                # Replace enabled: true with enabled: false (handles indentation)
                sed -i 's/^\(\s*\)enabled:\s*true/\1enabled: false/' "$file"
                echo -e "${GREEN}✓${NC} Disabled: $name"
                ((count++))
            else
                echo -e "${YELLOW}○${NC} Already disabled: $name"
            fi

            [ "$target" != "all" ] && break
        fi
    done

    if [ "$target" != "all" ] && [ $count -eq 0 ]; then
        local found=0
        for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
            [ -f "$file" ] || continue
            local name=$(get_handler_name "$file")
            [ "$name" = "$target" ] && found=1 && break
        done

        if [ $found -eq 0 ]; then
            echo -e "${RED}Error: Handler '$target' not found${NC}"
            exit 1
        fi
    fi

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
        ((wf_total++))
        is_workflow_enabled "$file" && ((wf_enabled++))
    done

    echo "Workflows: $wf_enabled enabled / $wf_total total"

    # Count handlers
    local h_total=0
    local h_enabled=0

    for file in "$HANDLERS_DIR"/*.yml "$HANDLERS_DIR"/*.yaml; do
        [ -f "$file" ] || continue
        ((h_total++))
        is_handler_enabled "$file" && ((h_enabled++))
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

# Main
case "${1:-}" in
    workflow)
        case "${2:-}" in
            list)
                workflow_list "${3:-all}"
                ;;
            enable)
                workflow_enable "$3"
                ;;
            disable)
                workflow_disable "$3"
                ;;
            show)
                workflow_show "$3"
                ;;
            *)
                echo -e "${RED}Unknown workflow command: ${2:-}${NC}"
                echo "Use: $0 workflow [list|enable|disable|show]"
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
            *)
                echo -e "${RED}Unknown handler command: ${2:-}${NC}"
                echo "Use: $0 handler [list|enable|disable|show]"
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
