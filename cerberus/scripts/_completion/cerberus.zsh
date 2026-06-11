#compdef cerberus cerberus-backup cerberus-calendar cerberus-contacts cerberus-cookbook cerberus-docs cerberus-gallery cerberus-mail cerberus-mcp cerberus-memory cerberus-notes cerberus-personal cerberus-preset cerberus-research cerberus-sessions cerberus-signature cerberus-skills cerberus-tasks cerberus-theme cerberus-webhook
# Zsh tab-completion for the cerberus umbrella + sub-CLIs.
#
# Drop in any directory on $fpath, e.g.:
#     fpath=(/path/to/cerberus-ui/scripts/_completion $fpath)
#     autoload -U compinit; compinit
#
# Then `cerberus <tab>` completes subcommands; `cerberus mail <tab>`
# completes mail subcommands; `cerberus-mail <tab>` works the same.

_cerberus_scripts_dir() {
    local self="${(%):-%x}"
    while [[ -L "$self" ]]; do self="$(readlink "$self")"; done
    cd "${self:h}/.." && pwd
}

typeset -gA _cerberus_subs

_cerberus_refresh() {
    _cerberus_subs=()
    local dir="$(_cerberus_scripts_dir)"
    local py="$dir/../venv/bin/python"
    [[ -x "$py" ]] || py="$(command -v python3)"
    local f sub help_out commands
    for f in "$dir"/cerberus-*; do
        [[ -x "$f" ]] || continue
        case "$f" in
            *.bak|*.pyc|*.pre-*) continue ;;
        esac
        sub="${${f:t}#cerberus-}"
        help_out=$("$py" "$f" --help 2>/dev/null) || continue
        commands=$(echo "$help_out" | grep -oE '\{[a-z0-9_,-]+\}' | head -1 \
            | tr -d '{}' | tr ',' ' ')
        _cerberus_subs[$sub]="$commands"
    done
}

_cerberus() {
    [[ ${#_cerberus_subs} -eq 0 ]] && _cerberus_refresh

    local cmd="${words[1]}"

    if [[ "$cmd" == "cerberus" ]]; then
        if (( CURRENT == 2 )); then
            local -a subs=(${(k)_cerberus_subs} help)
            _describe 'subcommand' subs
            return
        fi
        local sub="${words[2]}"
        if [[ "$sub" == "help" ]] && (( CURRENT == 3 )); then
            local -a subs=(${(k)_cerberus_subs})
            _describe 'subcommand' subs
            return
        fi
        if (( CURRENT == 3 )); then
            local -a sc=(${(s/ /)_cerberus_subs[$sub]})
            _describe 'command' sc
            return
        fi
        return
    fi

    # cerberus-foo <tab>
    local sub="${cmd#cerberus-}"
    if (( CURRENT == 2 )); then
        local -a sc=(${(s/ /)_cerberus_subs[$sub]})
        _describe 'command' sc
        return
    fi
}

_cerberus "$@"
