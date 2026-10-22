# Shell setup for the in-browser terminal. The sandbox runs real bash plus Wasmer's coreutils, grep, find, tar, sed and less.
# A WebAssembly sandbox has no Unix users, permissions or process table, so the commands below
# (chmod, chown, chgrp, stat, id, df, du, ps, top, diff, man, which, whereis, locate) are small stand-ins written in bash.

export USER=learner LOGNAME=learner HOSTNAME=playground
export PS1='\[\e[32m\]learner@playground\[\e[0m\]:\[\e[34m\]\w\[\e[0m\]$ '
export HISTFILE="$HOME/.pg_history" HISTCONTROL=ignoredups
alias more=less
alias ll='ls -alF'
alias grep='grep --color=auto'

_PGMETA="$HOME/.pgmeta"   # one line per path: path|octal-mode|owner|group

_pg_abs() {   # absolute, tidy path without needing the file to exist
  local p="$1"
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  p=$(echo "$p" | sed -e 's#/\./#/#g' -e 's#//*#/#g' -e 's#/\.$##' -e 's#\(.\)/$#\1#')
  echo "$p"
}

_pg_get() {   # prints "mode owner group" or fails
  local p="$1" a m o g
  [ -f "$_PGMETA" ] || return 1
  while IFS='|' read -r a m o g; do
    if [ "$a" = "$p" ]; then echo "$m $o $g"; return 0; fi
  done < "$_PGMETA"
  return 1
}

_pg_set() {   # path mode owner group
  local p="$1" a m o g tmp="$_PGMETA.tmp"
  : > "$tmp"
  if [ -f "$_PGMETA" ]; then
    while IFS='|' read -r a m o g; do
      [ "$a" = "$p" ] || echo "$a|$m|$o|$g" >> "$tmp"
    done < "$_PGMETA"
  fi
  echo "$p|$2|$3|$4" >> "$tmp"
  command mv "$tmp" "$_PGMETA"
}

# The sandbox cannot change the process umask, so the shell tracks it itself and applies it to the modes shown by ls/stat.
_PG_UMASK=0022
umask() {
  if [ "$1" = "-S" ]; then
    local m=$((8#$_PG_UMASK)) out="" w sh=6 b
    for w in u g o; do
      b=$(( (~m >> sh) & 7 )); sh=$((sh - 3))
      out="$out$w=$([ $((b & 4)) -ne 0 ] && printf r)$([ $((b & 2)) -ne 0 ] && printf w)$([ $((b & 1)) -ne 0 ] && printf x),"
    done
    echo "${out%,}"
  elif [ $# -eq 0 ]; then printf '%04o\n' $((8#$_PG_UMASK))
  elif echo "$1" | grep -Eq '^[0-7]{1,4}$'; then _PG_UMASK=$1
  else echo "bash: umask: $1: invalid octal number" >&2; return 1; fi
}

_pg_default_mode() {   # $1 = f|d ; honours the shell's umask
  local u=$((8#$_PG_UMASK))
  if [ "$1" = d ]; then printf '%o' $((8#777 & ~u)); else printf '%o' $((8#666 & ~u)); fi
}

_pg_mode_str() {   # octal -> rwxr-xr-x
  local m=$((8#$1)) s="" i b
  for i in 6 3 0; do
    b=$(( (m >> i) & 7 ))
    [ $((b & 4)) -ne 0 ] && s="${s}r" || s="${s}-"
    [ $((b & 2)) -ne 0 ] && s="${s}w" || s="${s}-"
    [ $((b & 1)) -ne 0 ] && s="${s}x" || s="${s}-"
  done
  echo "$s"
}

_pg_record() {   # remember creation mode for new files/dirs
  local p kind="$1"; shift
  for p in "$@"; do
    case "$p" in -*) continue ;; esac
    [ -e "$p" ] || continue
    local ap; ap=$(_pg_abs "$p")
    _pg_get "$ap" > /dev/null || _pg_set "$ap" "$(_pg_default_mode "$kind")" learner learner
  done
}

# cp -r works but wasm cannot set directory attributes, which makes it print a scary (harmless) error.
cp() {
  case " $* " in *" -"*[rRa]*) ;; *) command cp "$@"; return ;; esac
  local out rc
  out=$(command cp "$@" 2>&1); rc=$?
  out=$(printf '%s\n' "$out" | grep -v 'operation not supported on this platform')
  [ -n "$out" ] && printf '%s\n' "$out" >&2
  return $rc
}

touch() { command touch "$@"; local r=$?; _pg_record f "$@"; return $r; }
mkdir() { command mkdir "$@"; local r=$?; _pg_record d "$@"; return $r; }

ls() {
  local long=0 arg
  for arg in "$@"; do
    case "$arg" in --*) ;; -*l*) long=1 ;; esac
  done
  if [ $long -eq 0 ]; then command ls --color=auto "$@"; return; fi

  local base="." target="" n=0 a dironly=0
  for a in "$@"; do
    case "$a" in -*d*) dironly=1 ;; esac
    case "$a" in -*) ;; *) n=$((n + 1)); target="$a" ;; esac
  done
  [ $n -eq 1 ] && [ -d "$target" ] && [ $dironly -eq 0 ] && base="$target"
  case " $* " in *" -R "*|*" -"*R*) base="" ;; esac

  command ls "$@" | while IFS= read -r line; do
    case "$line" in
      [-dl]?????????*)
        line="${line/somebody somegroup/learner learner}"
        if [ -n "$base" ]; then
          local perms="${line%% *}" name="${line% -> *}" ap meta
          name="${name##* }"
          if [ "$base" = "." ] && [ $n -gt 1 ]; then name="$name"; fi
          if [ $n -eq 1 ] && [ $dironly -eq 1 ]; then base="."; fi
          ap=$(_pg_abs "$base/$name")
          [ "$n" -gt 1 ] && ap=$(_pg_abs "$name")
          if meta=$(_pg_get "$ap"); then
            set -- $meta
            local t="${perms:0:1}"
            line="${t}$(_pg_mode_str "$1") ${line#* }"
            line="${line/learner learner/$2 $3}"
          elif [ "${perms:0:1}" != l ]; then
            # no recorded mode: show the usual default instead of the sandbox's "everything allowed"
            local k=f; [ "${perms:0:1}" = d ] && k=d
            line="${perms:0:1}$(_pg_mode_str "$(_pg_default_mode $k)") ${line#* }"
          fi
        fi
        echo "$line" ;;
      *) echo "$line" ;;
    esac
  done
}

chmod() {
  [ $# -ge 2 ] || { echo "chmod: missing operand" >&2; return 1; }
  local spec="$1" f ap cur new rec=0
  if [ "$spec" = "-R" ]; then rec=1; shift; spec="$1"; fi
  shift
  for f in "$@"; do
    [ -e "$f" ] || { echo "chmod: cannot access '$f': No such file or directory" >&2; continue; }
    ap=$(_pg_abs "$f")
    local kind=f; [ -d "$f" ] && kind=d
    cur=$(_pg_get "$ap") && set -- $cur || set -- "$(_pg_default_mode $kind)" learner learner
    local mode=$((8#$1)) owner="$2" group="$3"
    if echo "$spec" | grep -Eq '^[0-7]{3,4}$'; then
      new=$((8#$spec))
    else
      new=$mode
      local clause
      for clause in $(echo "$spec" | tr ',' ' '); do
        local who op perm
        who=$(echo "$clause" | sed -E 's/^([ugoa]*).*/\1/')
        op=$(echo "$clause" | sed -E 's/^[ugoa]*([-+=]).*/\1/')
        perm=$(echo "$clause" | sed -E 's/^[ugoa]*[-+=](.*)$/\1/')
        [ -z "$who" ] && who=a
        local bits=0
        case "$perm" in *r*) bits=$((bits | 4)) ;; esac
        case "$perm" in *w*) bits=$((bits | 2)) ;; esac
        case "$perm" in *x*) bits=$((bits | 1)) ;; esac
        case "$perm" in *X*) [ -d "$f" ] && bits=$((bits | 1)) ;; esac
        local w mask shift_by
        for w in u g o; do
          case "$who" in *a*|*$w*) ;; *) continue ;; esac
          case $w in u) shift_by=6 ;; g) shift_by=3 ;; o) shift_by=0 ;; esac
          mask=$((7 << shift_by))
          case "$op" in
            +) new=$((new | (bits << shift_by))) ;;
            -) new=$((new & ~(bits << shift_by))) ;;
            =) new=$(( (new & ~mask) | (bits << shift_by) )) ;;
          esac
        done
      done
    fi
    _pg_set "$ap" "$(printf '%o' $new)" "$owner" "$group"
    set -- "$@"
  done
}

chown() {
  [ $# -ge 2 ] || { echo "chown: missing operand" >&2; return 1; }
  local spec="$1" owner group f ap meta kind; shift
  owner="${spec%%:*}"; group=""; case "$spec" in *:*) group="${spec#*:}" ;; esac
  # Like any non-root user: only your own user and group are allowed.
  if { [ -n "$owner" ] && [ "$owner" != learner ]; } || { [ -n "$group" ] && [ "$group" != learner ]; }; then
    for f in "$@"; do echo "chown: changing ownership of '$f': Operation not permitted" >&2; done
    return 1
  fi
  for f in "$@"; do
    [ -e "$f" ] || { echo "chown: cannot access '$f': No such file or directory" >&2; continue; }
    ap=$(_pg_abs "$f"); kind=f; [ -d "$f" ] && kind=d
    meta=$(_pg_get "$ap") && set -- $meta || set -- "$(_pg_default_mode $kind)" learner learner
    _pg_set "$ap" "$1" "${owner:-$2}" "${group:-$3}"
  done
}

chgrp() {
  [ $# -ge 2 ] || { echo "chgrp: missing operand" >&2; return 1; }
  local group="$1" f; shift
  if [ "$group" != learner ]; then
    for f in "$@"; do echo "chgrp: changing group of '$f': Operation not permitted" >&2; done
    return 1
  fi
  for f in "$@"; do chown ":$group" "$f"; done
}

stat() {
  local fmt="" f
  if [ "$1" = "-c" ]; then fmt="$2"; shift 2; fi
  for f in "$@"; do
    [ -e "$f" ] || { echo "stat: cannot statx '$f': No such file or directory" >&2; return 1; }
    local ap kind=f meta size; ap=$(_pg_abs "$f"); [ -d "$f" ] && kind=d
    meta=$(_pg_get "$ap") || meta="$(_pg_default_mode $kind) learner learner"
    set -- $meta
    size=$(command wc -c < "$f" 2>/dev/null || echo 0); [ $kind = d ] && size=4096
    if [ -n "$fmt" ]; then
      local out="$fmt"
      out="${out//%a/$1}"; out="${out//%U/$2}"; out="${out//%G/$3}"; out="${out//%s/$size}"; out="${out//%n/$f}"
      out="${out//%A/$kind$(_pg_mode_str "$1")}"
      echo "$out"
    else
      echo "  File: $f"
      echo "  Size: $size"
      echo "Access: (0$1/$kind$(_pg_mode_str "$1"))  Uid: ( 1000/ $2)   Gid: ( 1000/ $3)"
    fi
  done
}

id() {
  case "$1" in
    -un) echo learner ;;
    -gn) echo learner ;;
    -u|-g) echo 1000 ;;
    *) echo "uid=1000(learner) gid=1000(learner) groups=1000(learner)" ;;
  esac
}
whoami() { echo learner; }
hostname() { echo playground; }

_pg_bytes() {   # total bytes under a path
  local t=0 f s
  if [ -d "$1" ]; then
    for f in $(find "$1" -type f); do s=$(command wc -c < "$f"); t=$((t + s)); done
  else
    t=$(command wc -c < "$1")
  fi
  echo "$t"
}

_pg_human() {   # K blocks -> human
  local k=$1
  if [ "$k" -ge 1048576 ]; then echo "$((k / 1048576))G"
  elif [ "$k" -ge 1024 ]; then echo "$((k / 1024))M"
  else echo "${k}K"; fi
}

du() {
  local human=0 sum=0 all=0 p paths=() arg
  for arg in "$@"; do
    case "$arg" in
      -*) case "$arg" in *h*) human=1 ;; esac; case "$arg" in *s*) sum=1 ;; esac; case "$arg" in *a*) all=1 ;; esac ;;
      *) paths+=("$arg") ;;
    esac
  done
  [ ${#paths[@]} -eq 0 ] && paths=(.)
  local show k
  show() { k=$(( ($1 + 1023) / 1024 )); [ $k -lt 4 ] && k=4; if [ $human -eq 1 ]; then echo -e "$(_pg_human $k)\t$2"; else echo -e "$k\t$2"; fi; }
  for p in "${paths[@]}"; do
    [ -e "$p" ] || { echo "du: cannot access '$p': No such file or directory" >&2; continue; }
    if [ $sum -eq 0 ] && [ -d "$p" ]; then
      local d
      for d in $(find "$p" -type d | sort -r); do show "$(_pg_bytes "$d")" "$d"; done
      [ $all -eq 1 ] && for d in $(find "$p" -type f); do show "$(_pg_bytes "$d")" "$d"; done
    else
      show "$(_pg_bytes "$p")" "$p"
    fi
  done
}

df() {
  local human=0 arg
  for arg in "$@"; do case "$arg" in -*h*) human=1 ;; esac; done
  if [ $human -eq 1 ]; then
    printf 'Filesystem      Size  Used Avail Use%% Mounted on\nplayground      256M   12M  244M   5%% /workspace\ntmpfs           128M     0  128M   0%% /tmp\n'
  else
    printf 'Filesystem     1K-blocks  Used Available Use%% Mounted on\nplayground        262144 12288    249856   5%% /workspace\ntmpfs             131072     0    131072   0%% /tmp\n'
  fi
}

# This runtime has no job table and signals do not stop processes, so kill/wait/ps share a small record of finished pids.
_PG_DEAD=" "
_pg_gone() { case "$_PG_DEAD" in *" $1 "*) return 0 ;; esac; return 1; }

kill() {
  builtin kill "$@"; local r=$? a
  for a in "$@"; do case "$a" in ''|*[!0-9]*) ;; *) _PG_DEAD="$_PG_DEAD$a " ;; esac; done
  return $r
}

wait() {
  local a r=0
  if [ $# -eq 0 ]; then
    [ -n "$!" ] && ! _pg_gone "$!" && { builtin wait "$!"; r=$?; _PG_DEAD="$_PG_DEAD$! "; }
    return $r
  fi
  builtin wait "$@"; r=$?
  for a in "$@"; do _PG_DEAD="$_PG_DEAD$a "; done
  return $r
}

ps() {
  local wide=0; [ $# -gt 0 ] && wide=1
  if [ $wide -eq 1 ]; then printf 'UID          PID    PPID  C STIME TTY          TIME CMD\n'; else printf '    PID TTY          TIME CMD\n'; fi
  row() { if [ $wide -eq 1 ]; then printf 'learner %7s %7s  0 00:00 pts/0    00:00:00 %s\n' "$1" "$3" "$2"; else printf '%7s pts/0    00:00:00 %s\n' "$1" "$2"; fi; }
  row "$$" bash "$PPID"
  [ -n "$!" ] && ! _pg_gone "$!" && row "$!" "(background job)" "$$"
  _PG_PSN=$(( ${_PG_PSN:-100} + 1 ))
  row "$_PG_PSN" ps "$$"
}

top() {
  local n=2; [ -n "$!" ] && ! _pg_gone "$!" && n=3
  echo "top - $(date +%H:%M:%S) up 0 min,  1 user,  load average: 0.00, 0.00, 0.00"
  echo "Tasks: $n total,   1 running, $((n - 1)) sleeping,   0 stopped,   0 zombie"
  echo "(simulated: a WebAssembly sandbox has no process table, so only this shell's own processes are listed)"
  echo
  ps u
}

man() {
  case "$1" in -*) echo "man: options are not supported here; try: man ls" >&2; return 1 ;; esac
  [ -n "$1" ] || { echo "What manual page do you want?" >&2; return 1; }
  echo "$1(1) - no manual pages are installed in this sandbox; showing built-in help instead"
  echo
  if [ "$(type -t "$1")" = builtin ]; then help "$1"
  else "$1" --help 2>&1 | head -60; fi
}

which() {
  local c r=0 path
  for c in "$@"; do
    if path=$(type -P "$c"); then echo "$path"
    elif [ -n "$(type -t "$c")" ]; then echo "$c: shell built-in command"
    else echo "which: no $c in ($PATH)" >&2; r=1; fi
  done
  return $r
}

whereis() {
  local c p
  for c in "$@"; do
    p=$(type -P "$c") && echo "$c: $p" || echo "$c:"
  done
}

locate() {
  [ -n "$1" ] || { echo "locate: no pattern to search for specified" >&2; return 1; }
  find "$HOME" -iname "*$1*" 2>/dev/null | sed '/\.pgmeta/d; /\.pg_history/d; /\.pgrc/d'
}

clear() { printf '\033[H\033[2J\033[3J'; }

# diff, normal format, built on a longest-common-subsequence table.
diff() {
  local a="$1" b="$2"
  case "$a" in -u|-q|-y|-c) echo "diff: option $a is not supported here; showing normal format" >&2; a="$2"; b="$3" ;; esac
  [ -f "$a" ] && [ -f "$b" ] || { echo "diff: missing or unreadable file" >&2; return 2; }
  local -a A B L
  local line n=0 m=0 i j
  while IFS= read -r line || [ -n "$line" ]; do A[n]="$line"; n=$((n + 1)); done < "$a"
  while IFS= read -r line || [ -n "$line" ]; do B[m]="$line"; m=$((m + 1)); done < "$b"
  for ((i = 0; i <= n; i++)); do for ((j = 0; j <= m; j++)); do L[i * (m + 1) + j]=0; done; done
  for ((i = n - 1; i >= 0; i--)); do
    for ((j = m - 1; j >= 0; j--)); do
      if [ "${A[i]}" = "${B[j]}" ]; then L[i * (m + 1) + j]=$(( L[(i + 1) * (m + 1) + j + 1] + 1 ))
      else
        local d=${L[(i + 1) * (m + 1) + j]} r=${L[i * (m + 1) + j + 1]}
        [ "$d" -ge "$r" ] && L[i * (m + 1) + j]=$d || L[i * (m + 1) + j]=$r
      fi
    done
  done
  i=0; j=0
  local changed=0 ds de bs be
  _range() { if [ "$1" -eq "$2" ]; then echo "$1"; else echo "$1,$2"; fi; }
  while [ $i -lt $n ] || [ $j -lt $m ]; do
    if [ $i -lt $n ] && [ $j -lt $m ] && [ "${A[i]}" = "${B[j]}" ]; then i=$((i + 1)); j=$((j + 1)); continue; fi
    ds=$i; bs=$j
    local -a DEL=() ADD=()
    while [ $i -lt $n ] || [ $j -lt $m ]; do
      if [ $i -lt $n ] && [ $j -lt $m ] && [ "${A[i]}" = "${B[j]}" ]; then break; fi
      if [ $i -lt $n ] && { [ $j -ge $m ] || [ "${L[(i + 1) * (m + 1) + j]}" -ge "${L[i * (m + 1) + j + 1]}" ]; }; then DEL+=("${A[i]}"); i=$((i + 1))
      else ADD+=("${B[j]}"); j=$((j + 1)); fi
    done
    changed=1
    de=$i; be=$j
    local nd=${#DEL[@]} na=${#ADD[@]} x
    if [ $nd -gt 0 ] && [ $na -gt 0 ]; then echo "$(_range $((ds + 1)) $de)c$(_range $((bs + 1)) $be)"
    elif [ $nd -gt 0 ]; then echo "$(_range $((ds + 1)) $de)d$bs"
    else echo "${ds}a$(_range $((bs + 1)) $be)"; fi
    for x in "${DEL[@]}"; do echo "< $x"; done
    [ $nd -gt 0 ] && [ $na -gt 0 ] && echo "---"
    for x in "${ADD[@]}"; do echo "> $x"; done
  done
  return $changed
}

# tar -z needs fork(), which WebAssembly lacks; route compression through gzip instead.
tar() {
  case "$1" in
    -*z*|[a-z]*z*)
      local flags="$1" archive="$2" chdir="" rest=()
      shift 2
      if [ "$1" = "-C" ]; then chdir="$2"; shift 2; fi
      local plain="${flags//z/}"
      case "$plain" in *c*) command tar ${plain/f/} -f - "$@" | gzip > "$archive" ;;
        *x*) if [ -n "$chdir" ]; then gzip -dc "$archive" | command tar ${plain/f/} --no-same-owner -f - -C "$chdir" "$@"; else gzip -dc "$archive" | command tar ${plain/f/} --no-same-owner -f - "$@"; fi ;;
        *t*) gzip -dc "$archive" | command tar ${plain/f/} -f - "$@" ;;
      esac ;;
    *) command tar "$@" ;;
  esac
}

# These are C library functions, not commands.
for _c in fork getpid getppid pipe; do
  eval "$_c() { echo '$_c is a C system call, not a shell command. See its entry in the command list on the left.'; }"
done
unset _c

# An empty directory cannot be seeded as a file, so make it once (for the rmdir examples).
if [ ! -e "$HOME/.pg_init" ]; then command mkdir -p "$HOME/empty"; command touch "$HOME/.pg_init"; fi

cd "$HOME"
